var http = require("http");
var xml = require('xml2js');
var DocumentDBClient = require('documentdb').DocumentClient;
var config = require('./config');

var util = {};

var wordCache = {};

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

util.calculateDifficulty = function(turn) {
    // Interpolate between 5 and 20 words
    return 5 + Math.min(turn, 15); 
}

util.getRandomInt = function(min, max) {
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
    return { 
        spoken: vi._.replace(/^\s|\s\s|\s$/g, ' ' + vi.it[0] + ' '), 
        text: vi._.replace(/^\s|\s\s|\s$/g, ' ____ ') 
    };
}

function getDictionaryDefinition(word, callback) {
    var options = {
        method: 'GET',
        headers: {
            'Content-Type': 'application/json'
        },
        host: 'api.wordnik.com',
        path: '/v4/word.json/' + word + '/definitions?limit=3&includeRelated=false&sourceDictionaries=wordnet&useCanonical=false&includeTags=false&api_key=' + config.dictionaryApiKey 
    };

    http.request(options, function (response) {
        var str = '';

        response.on('data', function (chunk) {
            str += chunk;
        });

        response.on('end', function () {
            var jsonResp = JSON.parse(str);
            var defs = [];

            for(var i = 0; i < jsonResp.length; i++) {
                defs.push(jsonResp[i].text);
            }
            
            if(!(word in wordCache)) {
                 wordCache[word] = { "defs": [], "stcs": [] };
            }
            wordCache[word].defs = defs;

            callback(null, defs.length > 0);
        });
    }).end();
}

function getDictionarySentence(word, callback) {
    var options = {
        method: 'GET',
        headers: {
            'Content-Type': 'application/json'
        },
        host: 'api.wordnik.com',
        path: '/v4/word.json/' + word + '/examples?includeDuplicates=false&useCanonical=false&skip=0&limit=3&api_key=' + config.dictionaryApiKey 
    };

    http.request(options, function (response) {
        var str = '';

        response.on('data', function (chunk) {
            str += chunk;
        });

        response.on('end', function () {
            var jsonResp = JSON.parse(str);
            var stcs = [];

            for(var i = 0; i < jsonResp.examples.length; i++) {

                var sentence = jsonResp.examples[i].text;

                stcs.push({ spoken: sentence, text: sentence.replace(new RegExp(word, "g"), '___') });
            }
            
            if(!(word in wordCache)) {
                 wordCache[word] = { "defs": [], "stcs": [] };
            }
            wordCache[word].stcs = stcs;

            callback(null, stcs.length > 0);
        });
    }).end();
}


util.getSurvivalWord = function (diff, callback) {
    var options = {
        method: 'GET',
        headers: {
            'Content-Type': 'application/json'
        },
        host: 'api.wordnik.com',
        path: '/v4/words.json/randomWord?hasDictionaryDef=true&includePartOfSpeech=noun,adjective,verb&excludePartOfSpeech=noun-posessive,proper-noun,proper-noun-plural,proper-noun-posessive,given-name,family-name&minCorpusCount=100&maxCorpusCount=-1&minDictionaryCount=6&maxDictionaryCount=6&minLength=' + diff + '&maxLength=' + diff +'&api_key=' + config.dictionaryApiKey 
    };

    http.request(options, function (response) {
        var str = '';

        response.on('data', function (chunk) {
            str += chunk;
        });

        response.on('end', function () {
            var jsonResp = JSON.parse(str);

            if(jsonResp == null || !("word" in jsonResp))
                callback("Error getting a word");
            else {
                for (var i = 0; i < wordExceptions.length; ++i) {
                    if (jsonResp.word.indexOf(wordExceptions[i]) > -1) {
                        // Oh-oh, word contains a game loop command in it, which would break things
                        util.getSurvivalWord(diff, callback);
                        return;
                    }
                }
                
                console.log(jsonResp.word);
                callback(null, jsonResp.word);
            }
        });
    }).end();
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
                callback(null, null, true);  // ran out of words -> now compare the scores
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
    var token = util.getRandomInt(1, 9999).toString();
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
            name: name,
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
        callback(null, defs[util.getRandomInt(0, defs.length - 1)]);
    }

    if(word in wordCache && wordCache[word].defs.length > 0) {
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
        callback(null, stcs[util.getRandomInt(0, stcs.length - 1)])
    }

    if(word in wordCache && wordCache[word].stcs.length > 0) {
        returnStsc();
    }
    else {
        getDictionarySentence(word, returnStsc);
    }   
}

util.getLeaderboard = function (callback) {
    var client = new DocumentDBClient(config.dbEndpoint, {
        masterKey: config.dbKey
    });

    var now = new Date();
    var querySpec = {
        query: 'SELECT TOP 5 c.name, c.score FROM challeges c WHERE c.date>=@start AND c.date<@end ORDER BY c.score DESC',
        parameters: [{
            name: '@start',
            value: new Date(now.getFullYear(), now.getMonth(), now.getDate())   // TOOD: UTC
        },
        {
            name: '@end',
            value: new Date(now.getFullYear(), now.getMonth(), now.getDate()+1)   // TOOD: UTC
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
            var str = '';
            for(var i = 0; i < feed.length; i++) {
                var name = feed[i].name || 'Anonymous';
                str += ' [' + name + ' : ' + feed[i].score + '] ';
            }

            callback(null, str);
        }
    });
}

util.strip = function (s) {
    if (s && s.length > 0) {
        return s
            .replace(/ /g, "")
            .replace(/\./g, "")
            .replace(/,/g, "")
            .replace(/\?/g, "")
            .replace(/!/g, "")
            .replace(/-/g, "");
    }
}

util.spell = function (s) {
    if (s && s.length > 0) {
        return s.split("").join(" ");
    }
}

module.exports = util;