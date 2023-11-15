#!/usr/bin/env node

process.removeAllListeners("warning");

const path = require('path');
const fsp = require('fs').promises;
const tunebat = require("./tunebat");
const pLimit = import('p-limit');

const songFormats = [".mp3"];
const maxConcurrentQueries = 1;

async function getFiles(dir) {
    const children = await fsp.readdir(dir, {withFileTypes: true});
    const files = await Promise.all(children.map((child) => {
        const res = path.resolve(dir, child.name);
        return child.isDirectory() ? getFiles(res) : res;
    }));
    return Array.prototype.concat(...files);
}

(async () => {
    if(process.argv.length > 2) {
        // Show output in the terminal
        console.log("Searching for files...");
        let folder = path.normalize(process.argv[2]);
        let files = (await getFiles(folder)).filter((p) => songFormats.includes(path.extname(p))); // filter out non-songs
        files = (await Promise.all(files.map(async p => await tunebat.shouldBeTunebatted(p) ? p : null))).filter(p => p !== null); // filter out files that have already been tunebatted
        // the above line sucks :(
        console.log(`Found ${files.length} files.`);

        let fileCount = 0;
        let badOnes = [];
        process.stdout.write(`Files processed: ${fileCount}/${files.length}.`);
        const limit = (await pLimit).default(maxConcurrentQueries);
        const promises = files.map((file) => limit(async () => {
            try {
                await tunebat.tunebat(file)
            } catch(e) {
                if(e.constructor !== tunebat.TuneBatError) {
                    if(e.constructor === SyntaxError) {
                        console.log(`\n\n${e.message}\n\n`)
                    }
                    throw e;
                }
                badOnes.push(e);
            }

            // Increment count after because of changes to tens and hundreds of number
            let leftShift = `${fileCount}/${files.length}.`.length;
            fileCount++;
            process.stdout.write(`\x1b[${leftShift}D${fileCount}/${files.length}.`);
        }));
        await Promise.all(promises);
        console.log();

        if(badOnes.length > 0) {
            console.error(`\n${badOnes.length} files were not updated:`);
            badOnes.forEach((err) => console.error(`  - ${err.title} - ${err.artist} (${err.file}) (${err.score})`));
        }
        console.log(`Processed ${fileCount - badOnes.length}/${files.length} files.`);
    } else {
        console.error("tunebat <folder>")
        process.exit(1);
    }
})();