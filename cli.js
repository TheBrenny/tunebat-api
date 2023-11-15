#!/usr/bin/env node

process.removeAllListeners("warning");

const path = require('path');
const fsp = require('fs').promises;
const tunebat = require("./tunebat");
const pLimit = import('p-limit');
const rl = require("readline-sync");

const songFormats = [".mp3"];
const maxConcurrentQueries = 3;

async function getFiles(dir, recurse) {
    const children = await fsp.readdir(dir, {withFileTypes: true});
    const files = await Promise.all(children.map((child) => {
        const res = path.resolve(dir, child.name);
        return child.isDirectory() ? (recurse ? getFiles(res) : null) : res;
    }));
    return Array.prototype.concat(...files.filter((f) => f !== null));
}

let args = [...process.argv.slice(2)];

try {
(async () => {
    if(args.length > 0) {
        let options = collectOptions(args);

        if(args.length === 0) errorWithHelp();

        // Show output in the terminal
        console.log("Searching for files...");
        let folder = path.normalize(args[0]);
        let files = (await getFiles(folder, options.recurse)).filter((p) => songFormats.includes(path.extname(p))); // filter out non-songs
        files = (await Promise.all(files.map(async p => await tunebat.shouldBeTunebatted(p) ? p : null))).filter(p => p !== null); // filter out files that have already been tunebatted
        // the above line sucks :(
        console.log(`Found ${files.length} files.`);

        let fileCount = 0;
        let badOnes = [];
        let almostGood = [];
        process.stdout.write(`Files processed: ${fileCount}/${files.length}.`);
        const limit = (await pLimit).default(options.concurrent);
        const promises = files.map((file) => limit(async () => {
            try {
                let tbResult = await tunebat.tunebat(file);
                if(tbResult !== true) almostGood.push(tbResult);
            } catch(e) {
                if(e.constructor !== tunebat.TuneBatError) {
                    if(e.constructor === SyntaxError) console.log(`\n\n${e.message}\n\n`);
                    throw e;
                }
                badOnes.push(e);
            }

            // Increment count after because of changes to tens and hundreds of number
            let leftShift = `${fileCount}/${files.length}.`.length;
            fileCount++;
            process.stdout.write(`\x1b[0GFiles processed: ${fileCount}/${files.length}.`);
        }));
        await Promise.all(promises);
        console.log();

        for(let attempt of almostGood) {
            console.log(`Title didn't match for "${attempt.artist} - ${attempt.title}". Please select the nearest match:`);
            let titles = attempt.results.map((a) => `${a.as} - ${a.n}` + (a === attempt.bestMatch.el ? ` (best match: ${attempt.bestMatch.score})` : "")).slice(0, 35);
            let selection = rl.keyInSelect(titles, "Select matching title? ");
            if(selection >= 0 && selection < titles.length) {
                try {
                    await tunebat.tunebat(attempt.file, attempt.results[selection]);
                } catch(e) {
                    if(e.constructor !== tunebat.TuneBatError) {
                        if(e.constructor === SyntaxError) console.log(`\n\n${e.message}\n\n`);
                        throw e;
                    }
                    badOnes.push(e);
                }
            } else {
                badOnes.push(new tunebat.TuneBatError("Couldn't select a match.", attempt.file, attempt.title, attempt.artist, attempt.bestMatch.score))
            }
        }

        if(badOnes.length > 0) {
            console.error(`\n${badOnes.length} files were not updated:`);
            badOnes.forEach((err) => console.error(`  -> ${err.artist} - ${err.title} (${err.file}) (${err.score})`));
        }
        console.log(`Processed ${fileCount - badOnes.length}/${files.length} files.`);
    } else printHelp();
})();
} catch(e) {
    console.error(e);
    errorWithHelp();
}

function collectOptions(args) {
    let recurse = args.findIndex((e) => e === "-r" || e === "--recurse");
    if(recurse >= 0) {
        args.splice(recurse, 1);
        recurse = true;
    } else recurse = false;

    let concurrent = args.findIndex((e) => e === "-c" || e === "--concurrent");
    if(concurrent >= 0) {
        let tmp = args[concurrent + 1];
        args.splice(concurrent, 2);
        concurrent = parseInt(tmp);
    } else concurrent = maxConcurrentQueries;

    return {
        recurse,
        concurrent
    }
}

function errorWithHelp() {
    printHelp();
    process.exit(1);
}

function printHelp() {
    console.error("tunebat [-r|--recurse] <folder>")
}