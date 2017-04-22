var http = require("http");
var xml = require('xml2js');
var DocumentDBClient = require('documentdb').DocumentClient;
var config = require('./config');

var util = {};

var wordCache = {};

var wordStats = {};

// Don't serve words that contain commands that are used internally in GameDialog
var wordExceptions = [
    "define",
    "definition",
    "repeat",
    "sentence",
    "finish",
    "next"
];



util.guid = function() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        var r = Math.random()*16|0, v = c == 'x' ? r : (r&0x3|0x8);
        return v.toString(16);
    });
}

util.readWordStats = function (callback) {
    var client = new DocumentDBClient(config.dbEndpoint, {
        masterKey: config.dbKey
    });

    // Query documents and take 1st item.
    var iter = client.queryDocuments(
        config.dbColls.Stats,
        'SELECT TOP 1 * FROM stats s');
    iter.toArray(function (err, feed) {
        if (err) throw err;

        if (!feed || !feed.length) {
            throw new Error("Cannot retrieve word stats");
        }
        else {
            wordStats = feed[0];
            callback();
        }
    });
}

function getRandomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

util.getRandomString = function (len) {
    var text = "";
    var possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

    for (var i = 0; i < len; ++i) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    
    return text;
}

function processSentence(vi) {
    return vi._.replace('  ', ' ' + vi.it[0] + ' ');
}

function getDictionaryDefinition(word, callback) {
    var options = {
        host: 'www.dictionaryapi.com',
        path: '/api/v1/references/thesaurus/xml/' + word + '?key=' + config.dictionaryApiKey
    };

    http.request(options, function (response) {
        var str = '';

        response.on('data', function (chunk) {
            str += chunk;
        });

        response.on('end', function () {
            xml.parseString(str, function (err, result) {
                if (err) {
                    throw err;
                } else {
                    var defs = [];
                    var stcs = [];

                    if ('entry' in result.entry_list) {
                        for (var i = 0; i < result.entry_list.entry[0].sens.length; i++) {
                            defs.push(result.entry_list.entry[0].sens[i].mc[0]);
                            stcs.push(JSON.stringify(processSentence(result.entry_list.entry[0].sens[i].vi[0])));
                        }
                        wordCache[word] = { "defs": defs, "stcs": stcs };
                    }

                    callback(null, defs.length > 0);
                }
            });
        });
    }).end();
}

util.getSurvivalWord = function (diff, callback) {
    var client = new DocumentDBClient(config.dbEndpoint, {
        masterKey: config.dbKey
    });

    var querySpec = {
        query: 'SELECT TOP 1 * FROM words w WHERE w.dif=@dif AND w.seq=@seq',
        parameters: [{
            name: '@dif',
            value: diff
        }, {
            name: '@seq',
            value: getRandomInt(1, wordStats[diff])
        }]
    };

    var iter = client.queryDocuments(
        config.dbColls.Words,
        querySpec);

    iter.toArray(function (err, feed) {
        if (err) throw err;

        if (!feed || !feed.length) {
            throw new Error("Cannot retrieve word stats");
        }
        else {
            var word = feed[0].word;
            console.log(word);

            for (var i = 0; i < wordExceptions.length; ++i) {
                if (word.indexOf(wordExceptions[i]) > -1) {
                    // Oh-oh, word contains a game loop command in it, which would break things
                    util.getSurvivalWord(diff, callback);
                    return;
                }
            }            

            getDictionaryDefinition(word, function (err, valid) {
                if (!valid) {
                    // get a different word, one that has a definition
                    util.getSurvivalWord(diff, callback);
                }
                else {
                    // this is a good word with a definition
                    // update db

                    callback(null, word);
                }
            });
        }
    });
}

util.getChallengeWord = function (token, position, callback) {
    var client = new DocumentDBClient(config.dbEndpoint, {
        masterKey: config.dbKey
    });

    var querySpec = {
        query: 'SELECT TOP 1 * FROM challeges c WHERE c.id=@token',
        parameters: [{
            name: '@token',
            value: token
        }]
    };

    var iter = client.queryDocuments(
        config.dbColls.Challenges,
        querySpec);
    iter.toArray(function (err, feed) {
        if (err) {
            callback(err);
            return;
        }

        if (!feed || !feed.length) {
            callback("Challenge not found");
        }
        else {
            if(feed[0].words.length <= position) {
                callback(null, null, true);  // you won!
            }
            else {
                callback(null, feed[0].words[position], false);
            }
        }
    });
}

util.getChallengeScore = function (token, callback) {
    var client = new DocumentDBClient(config.dbEndpoint, {
        masterKey: config.dbKey
    });

    var querySpec = {
        query: 'SELECT TOP 1 * FROM challeges c WHERE c.id=@token',
        parameters: [{
            name: '@token',
            value: token
        }]
    };

    var iter = client.queryDocuments(
        config.dbColls.Challenges,
        querySpec);
    iter.toArray(function (err, feed) {
        if (err) {
            callback(err);
            return;
        }

        if (!feed || !feed.length) {
            callback("Challenge not found");
        }
        else {
            callback(null, feed[0].score);
        }
    });
}

util.generateToken = function(callback) {
    var client = new DocumentDBClient(config.dbEndpoint, {
        masterKey: config.dbKey
    });

    //get fixed size four positions game token
    var token = getRandomInt(1, 9999).toString();
    token = [ "000", "00", "0", "" ][token.length - 1] + token;

    var querySpec = {
        query: 'SELECT TOP 1 * FROM challeges c WHERE c.id=@token',
        parameters: [{
            name: '@token',
            value: token
        }]
    };

    var iter = client.queryDocuments(
        config.dbColls.Challenges,
        querySpec);
    iter.toArray(function (err, feed) {
        if (err) {
            callback(err);
            return;
        }

        if (!feed || !feed.length) {
            // token does not exist in db - good
            callback(null, token);
        }
        else {
            // token exists in the db - generate a new one
            generateToken(callback);
        }
    });
}

util.addToLeaderboard = function (name, token, words, score, callback) {
    var client = new DocumentDBClient(config.dbEndpoint, {
        masterKey: config.dbKey
    });

    client.createDocument(
        config.dbColls.Challenges,
        {
            id: token,
            words: words,
            score: score,
            date: new Date()
        }, function (err, doc) {
            if (err) {
                callback(err);
            }
            else 
            {
                callback(null, doc);
            }
        });
}

util.validateToken = function (token, callback) {
    var client = new DocumentDBClient(config.dbEndpoint, {
        masterKey: config.dbKey
    });

    var querySpec = {
        query: 'SELECT TOP 1 * FROM challeges c WHERE c.id=@token',
        parameters: [{
            name: '@token',
            value: token
        }]
    };

    var iter = client.queryDocuments(
        config.dbColls.Challenges,
        querySpec);
    iter.toArray(function (err, feed) {
        if (err) {
            callback(err, false);
            return;
        }

        if (!feed || !feed.length) {
            callback("Challenge not found", false);
        }
        else {
            callback(null, true);
        }
    });
}

util.getDefinition = function (word, callback) {
    // in-memory cache for now, should be stored in DB in the future when we implement proper definition normalization

    var returnDef = function() {
        var defs = wordCache[word].defs;
        callback(null, defs[getRandomInt(0, defs.length - 1)]);
    }

    if(word in wordCache) {
        returnDef();
    }
    else {
        getDictionaryDefinition(word, returnDef);
    }
    
}

util.getSentence = function (word, callback) {
    // in-memory cache for now, should be stored in DB in the future when we implement proper definition normalization

    var returnStsc = function() {
        var stcs = wordCache[word].stcs;
        callback(null, stcs[getRandomInt(0, stcs.length - 1)])
    }

    if(word in wordCache) {
        returnStsc();
    }
    else {
        getDictionaryDefinition(word, returnStsc);
    }   
}

util.getLeaderboard = function () {
    return 'Leaderboard:\n\n* Ondrej - 5000 pts\n\n* Dima - 4000 pts\n\n* Satya - 3000 pts';
}

util.strip = function (s) {
    if (s && s.length > 0) {
        return s
            .toLowerCase()
            .replace(/ /g, "")
            .replace(/\./g, "")
            .replace(/,/g, "")
            .replace(/-/g, "");
    }
}

util.spell = function (s) {
    if (s && s.length > 0) {
        return s.split("").join(" ");
    }
}

module.exports = util;