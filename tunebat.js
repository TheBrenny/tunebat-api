const nid = require("node-id3");
const simi = require("string-similarity");
const path = require("path");

const TuneBatVersion = 1;
const TunebatScoreThreshold = 0.8;
const base = "https://api.tunebat.com/api/tracks/search";
const param = "term";

// Testing indicates that you can execute 15 rapid queries before being told to wait a minute.
async function search(query) {
    query = encodeURI(query);
    let url = `${base}?${param}=${query}`;
    let r = (await fetch(url));
    let t = await r.text();
    try {
        return JSON.parse(t.normalize("NFD").replace(/’/g,"'")).data.items;
    } catch(e) {
        // console.log(r.headers);
        // console.log(t);
        if(r.headers.get("retry-after") !== null) {
            return await new Promise((resolve) => setTimeout(resolve, (parseInt(r.headers.get("retry-after")) + 5) * 1000))
                .then(() => search(query));
        }
        throw e;
    }
}

async function getID3Tags(file) {
    return await nid.read(file);
}

async function updateID3Tags(file, tags) {
    return await nid.update(tags, file);
}

async function shouldBeTunebatted(file) {
    let tags = await getID3Tags(file);
    if(tags.userDefinedText === undefined) return true;

    let tbV = tags.userDefinedText.find((el) => el.description === "Tunebat Version");
    if(tbV === undefined) return true;
    if(parseInt(tbV.value) <= TuneBatVersion) return false; // lte because we want the default to be true
    return true;
}

async function tunebat(file, match = null) {
    let tags = await getID3Tags(file);
    let bestMatch = {el: null, score: 0};
    let results;

    if(match === null) {
        if(tags.artist && tags.title) tags.artist = tags.artist?.split(",")[0] ?? "";
        else {
            let parts = path.basename(file, ".mp3").split(" - ");
            if(parts.length !== 2) throw new TuneBatError(`Couldn't collect artist and title from filename. Make sure it's "Artist - Title". Found "${parts.join(" - ")}"`, file, null, null, null);
            tags.artist = parts[0];
            tags.title = parts[1];
        }

        let query = `${tags.artist} ${tags.title}`;
        results = await search(query);

        // Find the best match. If the title is empty, then there's no way of knowing for sure, and manual labour is required.
        if((tags.title ?? "") !== "") {
            // loop through results and find the best match
            // the best match is defined as the title being exactly equal and the artists array from res containing the artist in the ID3 tags
            bestMatch = results.reduce((best, curr) => {
                if(tags.artist === "" || curr.as.find((a) => a.toLowerCase() === tags.artist.toLowerCase())) {
                    let score = simi.compareTwoStrings(curr.n, tags.title);
                    if(score > best.score) {
                        return {el: curr, score: score};
                    }
                }
                return best;
            }, bestMatch);
        }
    };

    /* Tunebat response:
    {
        id: "Spotify ID"
        n: "Track Title"
        as: ["Artists"]
        l: ---
        an: "Album"
        rd: ---
        is: ---
        ie: ---
        d: "Milliseconds"
        p: --- ? "Popularity -1"
        k: "Key"
        kv: ---
        c: "Camelot Key"
        b: "BPM"
        The below percents have a range of zero to one  inclusive (0 - 1)
        ac: --- ? "Acousticness percent"
        da: "Danceability percent"
        e: "Energy percent"
        h: "Happiness percent"
        i: "Instrumentalness" (probably percent)
        li: "Liveness percent"
        lo: "Loudness dB"
        s: "Speechiness percent" (does this mean signing vs speaking?)
        ci: [{album covers}]
        cr: ---
        r: [---]
        er: [---]
    }
    */
    if(match !== null || (bestMatch.el !== null && bestMatch.score >= TunebatScoreThreshold)) {
        bestMatch = match !== null ? match : bestMatch.el;

        // TODO: Add "Cover" tags
        tags = {
            ...tags,
            album: bestMatch.an,
            artist: bestMatch.as[0],
            initialKey: bestMatch.c,
            userDefinedText: [
                // They're stringed because ID3 doesn't support numbers
                {description: "Tunebat Version", value: `${TuneBatVersion}`},
                {description: "Spotify ID", value: `${bestMatch.id}`},
                {description: "Acousticness", value: `${bestMatch.ac}`},
                {description: "Danceability", value: `${bestMatch.da}`},
                {description: "Energy", value: `${bestMatch.e}`},
                {description: "Happiness", value: `${bestMatch.h}`},
                {description: "Instrumentalness", value: `${bestMatch.i}`},
                {description: "Liveness", value: `${bestMatch.li}`},
                {description: "Loudness", value: `${bestMatch.lo}`},
                {description: "Speechiness", value: `${bestMatch.s}`}
            ]
        };
        if(await updateID3Tags(file, tags)) return true;
        else throw new TuneBatError("Something bad happened?", file, tags.title, tags.artist, bestMatch.score);
    } else {
        // // throw a tunebat error with the message as smth like "couldn't find a good match"
        // throw new TuneBatError(`Couldn't find a good match`, file, tags.title, tags.artist, bestMatch.score);

        return {
            file,
            artist: tags.artist,
            title: tags.title,
            results,
            bestMatch
        };
    }
}

class TuneBatError extends Error {
    constructor(message, file, title, artist, score) {
        super(message);
        this.name = "TuneBatError";
        this.file = file;
        this.title = title;
        this.artist = artist;
        this.score = score;
    }
}

module.exports = {
    search,
    getID3Tags,
    updateID3Tags,
    tunebat,
    shouldBeTunebatted,
    TuneBatError
};