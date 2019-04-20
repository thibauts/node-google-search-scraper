var request = require('request');
var cheerio = require('cheerio');
var url     = require('url');

function search(options, callback) {
  var session = request.defaults({ jar : true });
  var host = options.host || 'www.google.com';
  var solver = options.solver;
  var params = options.params || {};
  var results = [];

  params.hl = params.hl || options.lang || 'en';

  if(options.age) params.tbs = 'qdr:' + options.age;
  if(options.query) params.q = options.query;

  params.start = params.start || 0;

  function getPage(params, callback) {
    session.get({
          uri: 'https://' + host + '/search',
          qs: params,
          followRedirect: false
        },
        function(err, res) {
          if(err) return callback(err);

          if(res.statusCode === 302) {
            var parsed = url.parse(res.headers.location, true);

            if(parsed.pathname !== '/search') {
              var err = new Error('Captcha');
              err.code = 'ECAPTCHA';
              err.location = res.headers.location;
              this.abort();
              return callback(err);
            } else {
              session.get({
                uri: res.headers.location,
                qs: params,
                followRedirect: false
              }, function(err, res) {
                if(err) return callback(err);
                callback(null, res.body);
              });
              return;
            }
          }

          callback(null, res.body);
        }
    );
  }
  function extractResults(body) {
    var results = [];
    var $ = cheerio.load(body);

    $('#search .g').each(function(i, elem) {
      var item = {};

      var elemUrl = $(this).find("h3 a");
      var elemMeta = $(this).find(".slp");
      var elemDesc = $(this).find(".st");
      var parsedUrl = url.parse(elemUrl.attr("href"), true);
      if (parsedUrl.pathname === '/url') {
        item['url'] = parsedUrl.query.q;
      }
      item['title'] = elemUrl.text();
      item['meta'] = elemMeta.text();
      item['desc'] = elemDesc.text();

      results.push(item);
    });

    return results;
  }
  function solveCaptcha(captchaUrl, callback) {

    var tmp = url.parse(captchaUrl);
    var baseUrl = url.format({
      protocol: tmp.protocol,
      hostname: tmp.host,
    });

    // Fetch captcha page
    session.get(captchaUrl, function(err, res) {
      if(err) return callback(err);

      var $ = cheerio.load(res.body);
      var captchaId = $('input[name=id]').attr('value');
      var continueUrl = $('input[name=continue]').attr('value');
      var formAction = $('form').attr('action');
      var imgSrc = $('img').attr('src');

      // Fetch captcha image
      session.get({uri: baseUrl + imgSrc, encoding: null}, function(err, res) {
        if(err) return callback(err);

        // Send to solver
        solver.solve(res.body, function(err, id, solution) {
          if(err) return callback(err);

          // Try solution
          session.get({
                uri: baseUrl + '/sorry/' + formAction,
                qs: {
                  id: captchaId,
                  captcha: solution,
                  continue: continueUrl
                }
              },
              function(err, res) {
                if(res.statusCode !== 200) return callback(new Error('Captcha decoding failed'));
                callback(null, res.body);
              }
          );

        });

      });

    });

  }

  const _results = [];

  return new Promise(resolve => {
    getPage(params, function onPage(err, body) {
      if(err) {
        if(err.code !== 'ECAPTCHA' || !solver) return callback(err);

        solveCaptcha(err.location, function(err, page) {
          if(err) return callback(err);
          onPage(null, page);
        });

        return;
      }

      var currentResults = extractResults(body);

      var newResults = currentResults.filter(function(result) {
        return results.indexOf(result) === -1;
      });

      newResults.forEach(function(result) {
        _results.push([null, result['url'], result]);
        callback(null, result['url'], result);
      });

      if(newResults.length === 0) {
        resolve(_results);
      }

      results = results.concat(newResults);

      if(!options.limit || results.length < options.limit) {
        params.start = results.length;
        getPage(params, onPage);
      }else{
        resolve(_results);
      }
    });
  });
}

module.exports.search = search;
