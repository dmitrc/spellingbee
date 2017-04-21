var http = require("http");
var xml = require('xml2js');
var DocumentDBClient = require('documentdb').DocumentClient;
var config = require('./config');

var util = {};

var defCache = {};

function getRandomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function getDictionaryDefinition (word, callback) {
    var options = {
        host: 'www.dictionaryapi.com', 
        path: '/api/v1/references/collegiate/xml/' + word + '?key=' + config.dictionaryApiKey
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
                    
                    if('entry' in result.entry_list) {
                        var def = result.entry_list.entry[0].def[0];
                        for(var i = 0; i < def.dt.length; i++) {
                            defs.push(JSON.stringify(def.dt[i]));
                        }
                    }
                     
                    defCache[word] = defs;
                    callback(null, defs.length > 0 ? defs[getRandomInt(0, defs.length - 1)] : null);
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

            getDictionaryDefinition(word, function(err, def) {
                if(!def) {
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
    var defs = defCache[word];
    callback(null, defs[getRandomInt(0, defs.length - 1)]);
}

util.getSentence = function (word) {
    return "Some sentence";
}

util.getLeaderboard = function () {
    return 'Leaderboard:\n\n* Ondrej - 5000 pts\n\n* Dima - 4000 pts\n\n* Satya - 3000 pts';
}

module.exports = util;