process.env.NODE_ENV = 'production';
var compression = require('compression');
var express = require('express');
var path = require('path');
var fs = require('fs');
var cheerio = require('cheerio');
var path = require('path')
const chalk = require('chalk');
const internalIp = require('internal-ip');
var bodyParser = require('body-parser')
var https = require('https');

const baseFolder = '/../../../';

function initServer(port, config, verbose) {
  port = port || 3000;
  verbose = verbose || false;

  function log(msg) {
    if (verbose) { console.log(msg); }
  }

  let server = express();

  var configFilePath = path.dirname(config.path);
  var testsFolder = path.resolve(path.join(configFilePath, config.testsFolder));
  var definitionFolder = path.join(configFilePath, config.definitions);

  server.use(compression());
  server.get('*gz', (req, res, next) => {
    res.set('Content-Encoding', 'gzip');
    //res.set('Content-Type', 'application/octet-stream');
    res.set('Content-Type', 'application/javascript');
    res.set('Cache-Control','no-cache, must-revalidate');
    res.set('Connection','close');
    res.set('Expires','-1');
    res.set('Access-Control-Allow-Origin', '*');
    next();
  });


  server
    .use('/', express.static(path.join(__dirname, '../../frontapp')))
    .use('/static', express.static(testsFolder))
    .use('/app.bundle.js', express.static(path.join(__dirname,'../../../dist/app.bundle.js')))
    .use('/tests.json', express.static(definitionFolder))
    .use(bodyParser.json());

  server
    .get('/webgfx-tests.js', (req, res) => {
      var html = fs.readFileSync(__dirname + baseFolder + 'dist/webgfx-tests.js', 'utf8');
      res.send(html);
    })
    .get('/transfer*', (req, res) => {
      var oriUrl = req.url.replace(/\/transfer\//, '');;
      var url = oriUrl.split('?')[0]; // Remove params like /file.json?p=whatever
      var pathf = path.join(testsFolder, url);

    })
    .post('/store_test_start', (req, res) => {
      console.log('Starting a new test', req.body);
      res.send('');
    })
    .post('/store_system_info', (req, res) => {
      console.log('Storing system info', req.body);
      res.send('');
    })
    .get('/tests*', (req, res) => {
      var oriUrl = req.url.replace(/\/tests\//, '');;
      var url = oriUrl.split('?')[0]; // Remove params like /file.json?p=whatever
      var pathf = path.join(testsFolder, url);

      if (oriUrl.match(/^https?:\/\//)) {
        var candidateTests = config.tests.filter(test => test.url.split('?')[0] === url);
        var test = candidateTests.find(test => oriUrl.indexOf(test.url) !== -1);
        process.env['NODE_TLS_REJECT_UNAUTHORIZED'] = 0;
        var request = https.get(oriUrl, response => {
          console.log('Status: ' + response.statusCode);
          console.log('Headers: ' + response.headers);
          response.setEncoding('utf8');
          let html = '';
          response.on('data', chunk => {
            console.log('Response: ' + chunk);
            html += chunk;
          });
          response.on('end', chunk => {
            console.log('Response Ended');
            var $ = cheerio.load(html);
            var head = $('head');
            head.prepend(`<base href="https://localhost:8081/">`);
            head.prepend(`<script>
              XMLHttpRequest.prototype._rawOpen = XMLHttpRequest.prototype.open;
              XMLHttpRequest.prototype.open = function open(method, url) {
                console.log('Before ', method, url);
                if (url.match(/^data:image\\//)) {
                  // Do nothing
                } else if (url.match(/^https:\\/\\/localhost:8080\\//)) {
                  url = url.replace(/^https:\\/\\/localhost:8080\\//, 'https://localhost:8081/');
                } else if (!url.match(/^https?:\\/\\//)) {
                  url = 'https://localhost:8081/' + url;
                }
                console.log('After ', method, url);
                return this._rawOpen(method, url);
              };
            </script>`);

          var referenceImageTest = true;

          if (test.skipReferenceImageTest !== true) {
            const referenceImageName = test.referenceImage || test.id;
            const referenceImagesFolder = path.join(testsFolder, config.referenceImagesFolder);
            const filepath = path.join(referenceImagesFolder, referenceImageName + '.png');

            if (!fs.existsSync(filepath)) {
              console.log(`ERROR: Reference image for test <${test.id}> "${referenceImageName}" not found! Disabling reference test. Please consider adding 'skipReferenceImageTest: true' to this test or generate a reference image.`);
              referenceImageTest = false;
            }
          } else {
            referenceImageTest = false;
          }

          test.serverIP = internalIp.v4.sync() || 'localhost';
          head.append(`<script>var GFXTESTS_CONFIG = ${JSON.stringify(test, null, 2)};</script>`);
          if (referenceImageTest) {
            head.append(`<script>var GFXTESTS_REFERENCEIMAGE_BASEURL = 'tests/${config.referenceImagesFolder}';</script>`);
          }
          // @todo Move socket.io reference to local
          head.append('<script src="https://cdnjs.cloudflare.com/ajax/libs/socket.io/2.1.1/socket.io.js"></script>')
              .append('<script src="https://localhost:8080/webgfx-tests.js"></script>');

          if (test.injectJS) {
            console.log(`- Injecting JS: ${test.injectJS.path} (${test.injectJS.where})`);
            switch (test.injectJS.where) {
              case "HEAD":
                head.append(`<script src="/tests/${test.injectJS.path}"></script>`); break;
              case "DEFER":
                head.append(`<script src="/tests/${test.injectJS.path}" defer></script>`); break;
              case "CUSTOM":
                var element = $(test.injectJS.selector);
                element.append(`<script src="/tests/${test.injectJS.path}"></script>`);
                break;
              case "INSIDE":
                // @REDEFINE
                var element = $('script').last();
                const injectPath = path.join(testsFolder, test.injectJS.path);
                var customJS = fs.readFileSync(injectPath, 'utf8');
                element.html(element.html() + customJS);
                break;
            }
          }

            res.set('Access-Control-Allow-Origin', '*');
            res.send($.html());
          });
        });
        return;
      }

      var ext = path.extname(url);
      if (ext === '.html') {
        // @todo Check that the filename is the entry main
        //var test = config.tests.find(test => test.url === url.replace(/\/tests\//, ''));
        // We need to filter initially because two tests could share the same base url
        var candidateTests = config.tests.filter(test => test.url.split('?')[0] === url);
        var test = candidateTests.find(test => oriUrl.indexOf(test.url) !== -1);

        if (test) {
          var html = fs.readFileSync(pathf, 'utf8');
          var $ = cheerio.load(html);
          var head = $('head');
          var referenceImageTest = true;

          if (test.skipReferenceImageTest !== true) {
            const referenceImageName = test.referenceImage || test.id;
            const referenceImagesFolder = path.join(testsFolder, config.referenceImagesFolder);
            const filepath = path.join(referenceImagesFolder, referenceImageName + '.png');

            if (!fs.existsSync(filepath)) {
              console.log(`ERROR: Reference image for test <${test.id}> "${referenceImageName}" not found! Disabling reference test. Please consider adding 'skipReferenceImageTest: true' to this test or generate a reference image.`);
              referenceImageTest = false;
            }
          } else {
            referenceImageTest = false;
          }

          test.serverIP = internalIp.v4.sync() || 'localhost';
          head.append(`<script>var GFXTESTS_CONFIG = ${JSON.stringify(test, null, 2)};</script>`);
          if (referenceImageTest) {
            head.append(`<script>var GFXTESTS_REFERENCEIMAGE_BASEURL = 'tests/${config.referenceImagesFolder}';</script>`);
          }
          // @todo Move socket.io reference to local
          head.append('<script src="https://cdnjs.cloudflare.com/ajax/libs/socket.io/2.1.1/socket.io.js"></script>')
              .append('<script src="/webgfx-tests.js"></script>');

          if (test.injectJS) {
            console.log(`- Injecting JS: ${test.injectJS.path} (${test.injectJS.where})`);
            switch (test.injectJS.where) {
              case "HEAD":
                head.append(`<script src="/tests/${test.injectJS.path}"></script>`); break;
              case "DEFER":
                head.append(`<script src="/tests/${test.injectJS.path}" defer></script>`); break;
              case "CUSTOM":
                var element = $(test.injectJS.selector);
                element.append(`<script src="/tests/${test.injectJS.path}"></script>`);
                break;
              case "INSIDE":
                // @REDEFINE
                var element = $('script').last();
                const injectPath = path.join(testsFolder, test.injectJS.path);
                var customJS = fs.readFileSync(injectPath, 'utf8');
                element.html(element.html() + customJS);
                break;
            }
          }

          res.send($.html());
        } else {
          res.send('No test found: ' + url);
        }
      } else {
        var file = decodeURI(pathf);
        if (fs.existsSync(file)) {
          res.sendFile(file);
        } else if (verbose) {
          console.log(`ERROR: File not found ${file}`);
        }
      }
    });

  https.createServer({
    key: fs.readFileSync('./key.pem', 'utf8'),
    cert: fs.readFileSync('./cert.pem', 'utf8')
  }, server).listen(port);

  var serverIP = internalIp.v4.sync() || 'localhost';
  console.log('* HTTPS Tests server listening on ' + chalk.yellow(serverIP + ':' + port));

/*
  server.listen(port, function(){
    var serverIP = internalIp.v4.sync() || 'localhost';
    console.log('* HTTP Tests server listening on ' + chalk.yellow(serverIP + ':' + port));
  });
*/
}


module.exports = initServer;