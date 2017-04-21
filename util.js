var http = require("http");
var xml = require('xml2js');
var DocumentDBClient = require('documentdb').DocumentClient;
var config = require('./config');

var util = {};

var wordCache = {};

function getRandomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function getDictionaryDefinition (word, callback) {
    var options = {
        host: 'www.dictionaryapi.com', 
        path: '/api/v1/references/thesaurus/xml/' + word + '?key=' + config.dictionaryApiKey
    };

    http.request(options, function(response) {
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
                    
                    if('entry' in result.entry_list) {
                        for(var i = 0; i < result.entry_list.entry[0].sens.length; i++) {
                            defs.push(result.entry_list.entry[0].sens[i].mc[0]);
                            stcs.push(JSON.stringify(result.entry_list.entry[0].sens[i].vi[0]));
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
                
    var sprocParams = [diff];

    client.executeStoredProcedure(config.dbSProc.getRandomWord, sprocParams, function(err, result) {
       if (err) {
            throw err;
        } else {
            var word = result.randomDocument.word;
            console.log(word); 

            getDictionaryDefinition(word, function(err, valid) {
                if(!valid) {
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

util.getChallengeWord = function (challengeId, position) {
    return "Sample";
}

util.getDefinition = function (word, callback) {
    // in-memory cache for now, should be stored in DB in the future when we implement proper definition normalization
    var defs = wordCache[word].defs;
    callback(null, defs[getRandomInt(0, defs.length - 1)]);
}

util.getSentence = function (word, callback) {
    // in-memory cache for now, should be stored in DB in the future when we implement proper definition normalization
    var stcs = wordCache[word].stcs;
    callback(null, stcs[getRandomInt(0, stcs.length - 1)])
}

util.getLeaderboard = function () {
    return 'Leaderboard:\n\n* Ondrej - 5000 pts\n\n* Dima - 4000 pts\n\n* Satya - 3000 pts';
}

module.exports = util;