import FakeTimers from 'fake-timers';
import CanvasHook from 'canvas-hook';
import WebXRHook from 'webxr-hook';
import PerfStats from 'performance-stats';
import seedrandom from 'seedrandom';
import queryString from 'query-string';
import {InputRecorder, InputReplayer} from 'input-events-recorder';
import EventListenerManager from './event-listeners';
import InputHelpers from './input-helpers';
import WebAudioHook from './webaudio-hook';
import WebVRHook from './webvr-hook';
import {resizeImageData} from './image-utils';
import pixelmatch from 'pixelmatch';
import WebGLStats from 'webgl-stats';

const parameters = queryString.parse(location.search);

function onReady(callback) {
  if (
    document.readyState === "complete" ||
    (document.readyState !== "loading" && !document.documentElement.doScroll)
  ) {
    callback();
  } else {
    document.addEventListener("DOMContentLoaded", callback);
  }
}


// Hacks to fix some Unity demos
console.logError = (msg) => console.error(msg);

window.TESTER = {
  XRready: false,
  ready: false,
  finished: false,
  inputLoading: false,

  // Currently executing frame.
  referenceTestFrameNumber: 0,
  firstFrameTime: null,
  // If -1, we are not running an event. Otherwise represents the wallclock time of when we exited the last event handler.
  previousEventHandlerExitedTime: -1,

  // Wallclock time denoting when the page has finished loading.
  pageLoadTime: null,

  // Holds the amount of time in msecs that the previously rendered frame took. Used to estimate when a stutter event occurs (fast frame followed by a slow frame)
  lastFrameDuration: -1,

  // Wallclock time for when the previous frame finished.
  lastFrameTick: -1,

  accumulatedCpuIdleTime: 0,

  // Keeps track of performance stutter events. A stutter event occurs when there is a hiccup in subsequent per-frame times. (fast followed by slow)
  numStutterEvents: 0,

  numFastFramesNeededForSmoothFrameRate: 120, // Require 120 frames i.e. ~2 seconds of consecutive smooth stutter free frames to conclude we have reached a stable animation rate

  // Measure a "time until smooth frame rate" quantity, i.e. the time after which we consider the startup JIT and GC effects to have settled.
  // This field tracks how many consecutive frames have run smoothly. This variable is set to -1 when smooth frame rate has been achieved to disable tracking this further.
  numConsecutiveSmoothFrames: 0,

  randomSeed: 1,
  mandatoryAutoEnterXR: typeof parameters['mandatory-autoenter-xr'] !== 'undefined',
  numFramesToRender: typeof parameters['num-frames'] === 'undefined' ? 1000 : parseInt(parameters['num-frames']),

  // Canvas used by the test to render
  canvas: null,

  inputRecorder: null,

  // Wallclock time for when we started CPU execution of the current frame.
  // var referenceTestT0 = -1;

  isReady: function() {
    // console.log(this.ready, this.XRready);
    return this.ready && this.XRready;
  },

  preTick: function() {
    if (GFXTESTS_CONFIG.preMainLoop) {
      GFXTESTS_CONFIG.preMainLoop();
    }

    // console.log('ready', this.ready, 'xrready', this.XRready);
    if (this.isReady()) {
      if (!this.started) {
        this.started = true;
      }
      WebGLStats.frameStart();
      // console.log('>> frame-start');
      this.stats.frameStart();
    }

    if (!this.canvas) {
      if (typeof parameters['no-rendering'] !== 'undefined') {
        this.ready = true;
      } else {
        // We assume the last webgl context being initialized is the one used to rendering
        // If that's different, the test should have a custom code to return that canvas
        if (CanvasHook.getNumContexts() > 0) {
          var context = CanvasHook.getContext(CanvasHook.getNumContexts() - 1);
          this.canvas = context.canvas;

          // Prevent events not defined as event-listeners
          this.canvas.onmousedown = this.canvas.onmouseup = this.canvas.onmousemove = () => {};

          // To prevent width & height 100%
          function addStyleString(str) {
            var node = document.createElement('style');
            node.innerHTML = str;
            document.body.appendChild(node);
          }

          addStyleString(`.gfxtests-canvas {width: ${this.canvasWidth}px !important; height: ${this.canvasHeight}px !important;}`);

          // To fix A-Frame
          addStyleString(`a-scene .a-canvas.gfxtests-canvas {width: ${this.canvasWidth}px !important; height: ${this.canvasHeight}px !important;}`);

          this.canvas.classList.add('gfxtests-canvas');

          this.onResize();

          // CanvasHook
          WebGLStats.setupExtensions(context);

          if (typeof parameters['recording'] !== 'undefined' && !this.inputRecorder) {
            this.inputRecorder = new InputRecorder(this.canvas);
            this.inputRecorder.enable();
          }

          if (typeof parameters['replay'] !== 'undefined' && GFXTESTS_CONFIG.input && !this.inputLoading) {
            this.inputLoading = true;
            fetch('/tests/' + GFXTESTS_CONFIG.input).then(response => {
              return response.json();
            })
            .then(json => {
              this.inputReplayer = new InputReplayer(this.canvas, json, this.eventListener.registeredEventListeners);
              this.inputHelpers = new InputHelpers(this.canvas);
              this.ready = true;
            });
          } else {
            this.ready = true;
          }
        }
        //@fixme else for canvas 2d without webgl
      }
    }

    if (this.referenceTestFrameNumber === 0) {
      /*
      if ('autoenter-xr' in parameters) {
        this.injectAutoEnterXR(this.canvas);
      }
      */
    }

    // referenceTestT0 = performance.realNow();
    if (this.pageLoadTime === null) this.pageLoadTime = performance.realNow() - pageInitTime;

    // We will assume that after the reftest tick, the application is running idle to wait for next event.
    if (this.previousEventHandlerExitedTime != -1) {
      this.accumulatedCpuIdleTime += performance.realNow() - this.previousEventHandlerExitedTime;
      this.previousEventHandlerExitedTime = -1;
    }
  },

  postTick: function () {
    if (!this.ready || !this.XRready) {return;}

    if (this.started){
      // console.log('<< frameend');
      this.stats.frameEnd();
    }

    if (this.inputRecorder) {
      this.inputRecorder.frameNumber = this.referenceTestFrameNumber;
    }

    if (this.inputReplayer) {
      this.inputReplayer.tick(this.referenceTestFrameNumber);
    }

    this.eventListener.ensureNoClientHandlers();

    var timeNow = performance.realNow();

    var frameDuration = timeNow - this.lastFrameTick;
    this.lastFrameTick = timeNow;
    if (this.referenceTestFrameNumber > 5 && this.lastFrameDuration > 0) {
      // This must be fixed depending on the vsync
      if (frameDuration > 20.0 && frameDuration > this.lastFrameDuration * 1.35) {
        this.numStutterEvents++;
        if (this.numConsecutiveSmoothFrames != -1) this.numConsecutiveSmoothFrames = 0;
      } else {
        if (this.numConsecutiveSmoothFrames != -1) {
          this.numConsecutiveSmoothFrames++;
          if (this.numConsecutiveSmoothFrames >= this.numFastFramesNeededForSmoothFrameRate) {
            console.log('timeUntilSmoothFramerate', timeNow - this.firstFrameTime);
            this.numConsecutiveSmoothFrames = -1;
          }
        }
      }
    }
    this.lastFrameDuration = frameDuration;
/*
    if (numPreloadXHRsInFlight == 0) { // Important! The frame number advances only for those frames that the game is not waiting for data from the initial network downloads.
      if (numStartupBlockerXHRsPending == 0) ++this.referenceTestFrameNumber; // Actual reftest frame count only increments after game has consumed all the critical XHRs that were to be preloaded.
      ++fakedTime; // But game time advances immediately after the preloadable XHRs are finished.
    }
*/
    this.referenceTestFrameNumber++;
    if (this.frameProgressBar) {
      var perc = parseInt(100 * this.referenceTestFrameNumber / this.numFramesToRender);
      this.frameProgressBar.style.width = perc + "%";
    }

    FakeTimers.fakedTime++; // But game time advances immediately after the preloadable XHRs are finished.

    if (this.referenceTestFrameNumber === 1) {
      this.firstFrameTime = performance.realNow();
      console.log('First frame submitted at (ms):', this.firstFrameTime - pageInitTime);
    }

    // We will assume that after the reftest tick, the application is running idle to wait for next event.
    this.previousEventHandlerExitedTime = performance.realNow();
    WebGLStats.frameEnd();
  },

  createDownloadImageLink: function(data, filename, description) {
    var a = document.createElement('a');
    a.setAttribute('download', filename + '.png');
    a.setAttribute('href', data);
    a.style.cssText = 'color: #FFF; display: inline-grid; text-decoration: none; margin: 2px; font-size: 14px;';

    var img = new Image();
    img.id = filename;
    img.src = data;
    a.appendChild(img);

    var label = document.createElement('label');
    label.className = 'button';
    label.innerHTML = description || filename;

    a.appendChild(label);

    document.getElementById('test_images').appendChild(a);
  },

  // XHRs in the expected render output image, always 'reference.png' in the root directory of the test.
  loadReferenceImage: function() {
    return new Promise ((resolve, reject) => {
      if (typeof GFXTESTS_REFERENCEIMAGE_BASEURL === 'undefined') {
        reject();
        return;
      }

      var img = new Image();
      var referenceImageName = parameters['reference-image'] || GFXTESTS_CONFIG.id;

      img.src = '/' + GFXTESTS_REFERENCEIMAGE_BASEURL + '/' + referenceImageName + '.png';
      img.onabort = img.onerror = reject;

      // reference.png might come from a different domain than the canvas, so don't let it taint ctx.getImageData().
      // See https://developer.mozilla.org/en-US/docs/Web/HTML/CORS_enabled_image
      img.crossOrigin = 'Anonymous';
      img.onload = () => {
        var canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        var ctx = canvas.getContext('2d');

        ctx.drawImage(img, 0, 0);
        this.referenceImageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  
        var data = canvas.toDataURL('image/png');
        this.createDownloadImageLink(data, 'reference-image', 'Reference image');

        resolve(this.referenceImageData);
      }
      this.referenceImage = img;
    });
  },

  getCurrentImage: function(callback) {
    // Grab rendered WebGL front buffer image to a JS-side image object.
    var actualImage = new Image();

    try {
      const init = performance.realNow();
      actualImage.src = this.canvas.toDataURL("image/png");
      actualImage.onload = callback;
      TESTER.stats.timeGeneratingReferenceImages += performance.realNow() - init;
    } catch(e) {
      console.error("Can't generate image");
    }
  },

  doImageReferenceCheck: function() {
    var actualImage = new Image();
    var self = this;

    return new Promise ((resolve, reject) => {
      function reftest (evt) {
        var img = actualImage;
        var canvasCurrent = document.createElement('canvas');
        var context = canvasCurrent.getContext('2d');

        canvasCurrent.width = img.width;
        canvasCurrent.height = img.height;
        context.drawImage(img, 0, 0);

        var currentImageData = context.getImageData(0, 0, img.width, img.height);
        
        const init = performance.realNow();
        TESTER.stats.timeGeneratingReferenceImages += performance.realNow() - init;
        self.loadReferenceImage().then(refImageData => {
          var width = refImageData.width;
          var height = refImageData.height;
          var canvasDiff = document.createElement('canvas');
          var diffCtx = canvasDiff.getContext('2d');
          canvasDiff.width = width;
          canvasDiff.height = height;
          var diff = diffCtx.createImageData(width, height);

          var newImageData = diffCtx.createImageData(width, height);
          resizeImageData(currentImageData, newImageData);

          var expected = refImageData.data;
          var actual = newImageData.data;

          var threshold = typeof GFXTESTS_CONFIG.referenceCompareThreshold === 'undefined' ? 0.2 : GFXTESTS_CONFIG.referenceCompareThreshold;
          var numDiffPixels = pixelmatch(expected, actual, diff.data, width, height, {threshold: threshold});
          var diffPerc = numDiffPixels / (width * height) * 100;

          var fail = diffPerc > 0.2; // diff perc 0 - 100%
          var result = {result: 'pass'};

          if (fail) {
            var divError = document.getElementById('reference-images-error');
            divError.querySelector('h3').innerHTML = `ERROR: Reference image mismatch (${diffPerc.toFixed(2)}% different pixels)`;
            divError.style.display = 'block';
            result = {
              result: 'fail',
              diffPerc: diffPerc,
              numDiffPixels: numDiffPixels,
              failReason: 'Reference image mismatch'
            };

            var benchmarkDiv = document.getElementById('test_finished');
            benchmarkDiv.className = 'fail';
            benchmarkDiv.querySelector('h1').innerText = 'Test failed!';

            diffCtx.putImageData(diff, 0, 0);

            var data = canvasDiff.toDataURL('image/png');
            self.createDownloadImageLink(data, 'canvas-diff', 'Difference');
            reject(result);
          } else {
            resolve(result);
          }
        }).catch(() => {
          var benchmarkDiv = document.getElementById('test_finished');
          benchmarkDiv.className = 'fail';
          benchmarkDiv.querySelector('h1').innerText = 'Test failed!';

          var divError = document.getElementById('reference-images-error');
          divError.querySelector('h3').innerHTML = `ERROR: Failed to load reference image`;
          divError.style.display = 'block';

          reject({
            result: 'fail',
            failReason: 'Error loading reference image'
          });
        });
      }

      try {
        const init = performance.realNow();
        actualImage.src = this.canvas.toDataURL("image/png");
        actualImage.onload = reftest;
        TESTER.stats.timeGeneratingReferenceImages += performance.realNow() - init;
      } catch(e) {
        reject();
      }
    });
  },

  initServer: function () {
    var serverUrl = 'http://' + GFXTESTS_CONFIG.serverIP + ':8888';

    this.socket = io.connect(serverUrl);

    this.socket.on('connect', function(data) {
      console.log('Connected to testing server');
    });

    this.socket.on('error', (error) => {
      console.log(error);
    });

    this.socket.on('connect_error', (error) => {
      console.log(error);
    });

    this.socket.emit('test_started', {id: GFXTESTS_CONFIG.id, testUUID: parameters['test-uuid']});

    this.socket.on('next_benchmark', (data) => {
      console.log('next_benchmark', data);
      window.location.replace(data.url);
    });
  },

  addInputDownloadButton: function () {
      // Dump input
      function saveString (text, filename, mimeType) {
        saveBlob(new Blob([ text ], { type: mimeType }), filename);
      }

      function saveBlob (blob, filename) {
        var link = document.createElement('a');
        link.style.display = 'none';
        document.body.appendChild(link);
        link.href = URL.createObjectURL(blob);
        link.download = filename || 'input.json';
        link.click();
        // URL.revokeObjectURL(url); breaks Firefox...
      }

      var json = JSON.stringify(this.inputRecorder.events, null, 2);

      //console.log('Input recorded', json);

      var link = document.createElement('a');
      document.body.appendChild(link);
      link.href = '#';
      link.className = 'button';
      link.onclick = () => saveString(json, GFXTESTS_CONFIG.id + '.json', 'application/json');
      link.appendChild(document.createTextNode(`Download input JSON`)); // (${this.inputRecorder.events.length} events recorded)
      document.getElementById('test_finished').appendChild(link);
  },

  generateFailedBenchmarkResult: function (failReason) {
    return {
      test_id: GFXTESTS_CONFIG.id,
      autoEnterXR: this.autoEnterXR,
      revision: GFXTESTS_CONFIG.revision || 0,
      numFrames: this.numFramesToRender,
      pageLoadTime: this.pageLoadTime,
      result: 'fail',
      failReason: failReason
    };
  },

  generateBenchmarkResult: function () {
    var timeEnd = performance.realNow();
    var totalTime = timeEnd - pageInitTime; // Total time, including everything.

    return new Promise (resolve => {
      var totalRenderTime = timeEnd - this.firstFrameTime;
      var cpuIdle = this.accumulatedCpuIdleTime * 100.0 / totalRenderTime;
      var fps = this.numFramesToRender * 1000.0 / totalRenderTime;

      var result = {
        test_id: GFXTESTS_CONFIG.id,
        stats: {
          perf: this.stats.getStatsSummary(),
          webgl: WebGLStats.getSummary()
          // !!!! oculus_vrapi: this.
        },
        autoEnterXR: this.autoEnterXR,
        revision: GFXTESTS_CONFIG.revision || 0,
        webaudio: WebAudioHook.stats,
        numFrames: this.numFramesToRender,
        totalTime: totalTime,
        timeToFirstFrame: this.firstFrameTime - pageInitTime,
        avgFps: fps,
        numStutterEvents: this.numStutterEvents,
        totalRenderTime: totalRenderTime,
        cpuTime: this.stats.totalTimeInMainLoop,
        avgCpuTime: this.stats.totalTimeInMainLoop / this.numFramesToRender,
        cpuIdleTime: this.stats.totalTimeOutsideMainLoop,
        cpuIdlePerc: this.stats.totalTimeOutsideMainLoop * 100 / totalRenderTime,
        pageLoadTime: this.pageLoadTime,
        result: 'pass',
        logs: this.logs
      };

      // @todo Indicate somehow that no reference test has been performed
      if (typeof parameters['skip-reference-image-test'] !== 'undefined') {
        resolve(result);
      } else {
        this.doImageReferenceCheck().then(refResult => {
          Object.assign(result, refResult);
          resolve(result);
        }).catch(refResult => {
          Object.assign(result, refResult);
          resolve(result);
        });
      }
    });
  },

  benchmarkFinished: function () {
    this.injectBenchmarkFinishedHTML();

    if (this.inputRecorder) {
      this.addInputDownloadButton();
    }

    try {
      var data = this.canvas.toDataURL("image/png");
      var description = this.inputRecorder ? 'Download reference image' : 'Actual render';
      this.createDownloadImageLink(data, GFXTESTS_CONFIG.id, description);
    } catch(e) {
      console.error("Can't generate image", e);
    }

    if (this.inputRecorder) {
      document.getElementById('test_finished').style.visibility = 'visible';
      document.getElementById('reference-images-error').style.display = 'block';
    } else {
      this.generateBenchmarkResult().then(result => {
        this.processBenchmarkResult(result);
      });
    }
  },
  injectBenchmarkFinishedHTML: function() {
    var style = document.createElement('style');
    style.innerHTML = `
      #test_finished {
        align-items: center;
        background-color: #ddd;
        bottom: 0;
        color: #000;
        display: flex;
        font-family: sans-serif;
        font-weight: normal;
        font-size: 20px;
        justify-content: center;
        left: 0;
        position: absolute;
        right: 0;
        top: 0;
        z-index: 99999;
        flex-direction: column;
      }

      #test_finished.pass {
        background-color: #9f9;
      }

      #test_finished.fail {
        background-color: #f99;
      }

      #test_images {
        margin-bottom: 20px;
      }

      #test_images img {
        width: 300px;
        border: 1px solid #007095;
      }

      #test_finished .button {
        background-color: #007095;
        border-color: #007095;
        margin-bottom: 10px;
        color: #FFFFFF;
        cursor: pointer;
        display: inline-block;
        font-family: "Helvetica Neue", "Helvetica", Helvetica, Arial, sans-serif !important;
        font-size: 14px;
        font-weight: normal;
        line-height: normal;
        width: 300px;
        padding: 10px 1px;
        text-align: center;
        text-decoration: none;
        transition: background-color 300ms ease-out;
      }

      #test_finished .button:hover {
        background-color: #0078a0;
      }
    `;
    document.body.appendChild(style);

    var div = document.createElement('div');
    div.innerHTML = `<h1>Test finished!</h1>`;
    div.id = 'test_finished';
    div.style.visibility = 'hidden';

    var divReferenceError = document.createElement('div');
    divReferenceError.id = 'reference-images-error';
    divReferenceError.style.cssText = 'text-align:center; color: #f00;'
    divReferenceError.innerHTML = '<h3></h3>';
    divReferenceError.style.display = 'none';

    div.appendChild(divReferenceError);
    var divImg = document.createElement('div');
    divImg.id = 'test_images';
    divReferenceError.appendChild(divImg);

    document.body.appendChild(div);
  },
  processBenchmarkResult: function(result) {
    if (this.socket) {
      if (parameters['test-uuid']) {
        result.testUUID = parameters['test-uuid'];
      }
      this.socket.emit('test_finish', result);
      this.socket.disconnect();
    }

    var benchmarkDiv = document.getElementById('test_finished');
    benchmarkDiv.className = result.result;
    if (result.result === 'pass') {
      benchmarkDiv.querySelector('h1').innerText = 'Test passed!';
    }

    benchmarkDiv.style.visibility = 'visible';

    console.log('Finished!', result);
    if (typeof window !== 'undefined' && window.close && typeof parameters['no-close-on-fail'] === 'undefined') {
      window.close();
    }
  },

  wrapErrors: function () {
    window.addEventListener('error', error => evt.logs.catchErrors = {
      message: evt.error.message,
      stack: evt.error.stack,
      lineno: evt.error.lineno,
      filename: evt.error.filename
    });

    var wrapFunctions = ['error','warning','log'];
    wrapFunctions.forEach(key => {
      if (typeof console[key] === 'function') {
        var fn = console[key].bind(console);
        console[key] = (...args) => {
          if (key === 'error') {
            this.logs.errors.push(args);
          } else if (key === 'warning') {
            this.logs.warnings.push(args);
          }

          if (GFXTESTS_CONFIG.sendLog)
            TESTER.socket.emit('log', args);

          return fn.apply(null, args);
        }
      }
    });
  },

  addInfoOverlay: function() {
    onReady(() => {
      if (typeof parameters['info-overlay'] === 'undefined') {
        return;
      }

      var divOverlay = document.createElement('div');
      divOverlay.style.cssText = `
        position: absolute;
        top: 0;
        font-family: Monospace;
        color: #fff;
        font-size: 12px;
        text-align: center;
        font-weight: normal;
        background-color: rgb(95, 40, 136);
        width: 100%;
        padding: 5px`;
      document.body.appendChild(divOverlay);
      divOverlay.innerText = parameters['info-overlay'];
    })
  },

  addProgressBar: function() {
    onReady(() => {
      var divProgressBars = document.createElement('div');
      divProgressBars.style.cssText = 'position: absolute; left: 0; bottom: 0; background-color: #333; width: 200px; padding: 5px 5px 0px 5px;';
      document.body.appendChild(divProgressBars);

      var orderGlobal = parameters['order-global'];
      var totalGlobal = parameters['total-global'];
      var percGlobal = Math.round(orderGlobal/totalGlobal * 100);
      var orderTest = parameters['order-test'];
      var totalTest = parameters['total-test'];
      var percTest = Math.round(orderTest/totalTest * 100);

      function addProgressBarSection(text, color, perc, id) {
        var div = document.createElement('div');
        div.style.cssText='width: 100%; height: 20px; margin-bottom: 5px; overflow: hidden; background-color: #f5f5f5;';
        divProgressBars.appendChild(div);

        var divProgress = document.createElement('div');
        div.appendChild(divProgress);
        if (id) {
          divProgress.id = id;
        }
        divProgress.style.cssText=`
          width: ${perc}%;background-color: ${color} float: left;
          height: 100%;
          font-family: Monospace;
          font-size: 12px;
          font-weight: normal;
          line-height: 20px;
          color: #fff;
          text-align: center;
          background-color: #337ab7;
          -webkit-box-shadow: inset 0 -1px 0 rgba(0,0,0,.15);
          box-shadow: inset 0 -1px 0 rgba(0,0,0,.15);`;
          divProgress.innerText = text;;
      }

      if (typeof parameters['order-global'] !== 'undefined') {
        addProgressBarSection(`${orderTest}/${totalTest} ${percTest}%`, '#5bc0de', percTest);
        addProgressBarSection(`${orderGlobal}/${totalGlobal} ${percGlobal}%`, '#337ab7', percGlobal);
      }

      addProgressBarSection('', '#337ab7', 0, 'numframes');
      this.frameProgressBar = document.getElementById('numframes');

    });
  },

  hookModals: function() {
    // Hook modals: This is an unattended run, don't allow window.alert()s to intrude.
    window.alert = function(msg) { console.error('window.alert(' + msg + ')'); }
    window.confirm = function(msg) { console.error('window.confirm(' + msg + ')'); return true; }
  },
  RAFs: [], // Used to store instances of requestAnimationFrame's callbacks
  prevRAFReference: null, // Previous called requestAnimationFrame callback
  started: false,
  requestAnimationFrame: function (callback) {
    const hookedCallback = (p, frame) => {
      if (this.finished) {
        return;
      }

      if (this.RAFs.length > 1) {
        console.log('hookedCallback', this.RAFs);
        console.log(callback);
      }

      // Push the callback to the list of currently running RAFs
      if (this.RAFs.indexOf(callback) === -1 &&
        this.RAFs.findIndex(f => f.toString() === callback.toString()) === -1) {
        this.RAFs.push(callback);
      }

      // If the current callback is the first on the list, we assume the frame just started
      if (this.RAFs[0] === callback) {
        // console.log("pretick");
        this.preTick();
      }

      if (frame) {
        let oriGetPose = frame.getPose;
        frame.getPose = function() {
          var pose = oriGetPose.apply(this, arguments);
          if (pose) {
            let amp = 0.5;
            let freq = 0.0005;
            let x = Math.sin(performance.now() * freq) * amp;
            let y = Math.cos(performance.now() * freq) * amp;
            return {
              transform: new XRRigidTransform(new DOMPoint(x, 1.6 + y, -1, 1),new DOMPoint(0,0,0,1)),
              emulatedPosition: false
            };
          } else {
            return pose;
          }
        }

        let oriGetViewerPose = frame.getViewerPose;
        frame.getViewerPose = function() {
          var pose = oriGetViewerPose.apply(this, arguments);
          let newPose = {
            views: []
          };

          var baseLayer = frame.session.renderState.baseLayer;
          if (!baseLayer.oriGetViewport) {
            baseLayer.oriGetViewport = baseLayer.getViewport;
            baseLayer.getViewport = function() {
              let view = arguments[0].originalView;
              if (view) {
                return baseLayer.oriGetViewport.apply(this, [view]);
              } else {
                return baseLayer.oriGetViewport.apply(this, arguments);
              }
            }
          }

          if ( pose !== null ) {
            var views = pose.views;
            for ( var i = 0; i < views.length; i ++ ) {
              var view = views[ i ];
              if (!view.originalView) {
                var transform = new XRRigidTransform(new DOMPoint(0, 1.6, 0, 1),new DOMPoint(0,0,0,1))
                var newView = {
                  eye: view.eye,
                  projectionMatrix: view.projectionMatrix,
                  transform: transform,
                  originalView: view
                };
                newPose.views.push(newView);
              } else {
                newPose.views.push(view);
              }
            }
          }
          return newPose;
        }
      }
      callback(performance.now(), frame);

      // If reaching the last RAF, execute all the post code
      if (this.RAFs[ this.RAFs.length - 1 ] === callback && this.started) {
        // console.log("posttick", this.referenceTestFrameNumber);
        // @todo Move all this logic to a function to clean up this one
        this.postTick();

        if (this.referenceTestFrameNumber === this.numFramesToRender) {
          console.info('>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>> FINISHED!')
          this.releaseRAF();
          this.finished = true;
          this.benchmarkFinished();
          return;
        }

        if (GFXTESTS_CONFIG.postMainLoop) {
          GFXTESTS_CONFIG.postMainLoop();
        }
      }

      // If the previous RAF is the same as now, just reset the list
      // in case we have stopped calling some of the previous RAFs
      if (this.prevRAFReference === callback && (this.RAFs[0] !== callback || this.RAFs.length > 1)) {
        this.RAFs = [callback];
      }
      this.prevRAFReference = callback;
    }
    return this.currentRAFContext.realRequestAnimationFrame(hookedCallback);
  },
  currentRAFContext: window,
  releaseRAF: function () {
    this.RAFcontexts.forEach(context => {
      context.requestAnimationFrame = () => {};
    })

    //this.currentRAFContext.requestAnimationFrame = () => {};
    if ('VRDisplay' in window &&
      this.currentRAFContext instanceof VRDisplay &&
      this.currentRAFContext.isPresenting) {
      this.currentRAFContext.exitPresent();
    }
  },
  RAFcontexts: [],
  hookRAF: function (context) {
    console.log('Hooking', context);
    if (!context.realRequestAnimationFrame) {
      context.realRequestAnimationFrame = context.requestAnimationFrame;
      this.RAFcontexts.push(context);
    }
    context.requestAnimationFrame = this.requestAnimationFrame.bind(this);
    this.currentRAFContext = context;
  },
  unhookRAF: function (context) {
    console.log('unhooking', context, context.realRequestAnimationFrame);
    if (context.realRequestAnimationFrame) {
      context.requestAnimationFrame = context.realRequestAnimationFrame;
    }
  },
  init: function () {
    this.initServer();

    if (!GFXTESTS_CONFIG.providesRafIntegration) {
      this.hookRAF(window);
    }

    this.addProgressBar();
    this.addInfoOverlay();

    console.log('Frames to render:', this.numFramesToRender);

    if (!GFXTESTS_CONFIG.dontOverrideTime) {
      FakeTimers.enable();
    }

    if (!GFXTESTS_CONFIG.dontOverrideWebAudio) {
      WebAudioHook.enable(typeof parameters['fake-webaudio'] !== 'undefined');
    }

    // @todo Use config
    WebVRHook.enable(vrdisplay => {
      this.hookRAF(vrdisplay);
    });

    if ('autoenter-xr' in parameters) {
      this.injectAutoEnterXR(this.canvas);
      navigator.xr.isSessionSupported('immersive-vr').then((supported) => {
        if (!supported) {
          this.XRready = true;
        }
      });

    } else {
      this.XRready = true;
    }
/*
    if (GFXTESTS_CONFIG.injectJS) {
      function injectJS(url, where, onLoad, onError) {
        var link = document.createElement('script');
        link.src = '/tests/' + url;
        link.charset = 'utf-8';
        link.setAttribute('fxr-2dcontent-api', 'style');

        if (onLoad) {
          link.addEventListener('load', onLoad);
        }

        if (onError) {
          link.addEventListener('error', onError);
        }

        if (where === "before") {
          document.head.appendChild(link);
        } else {
          document.body.appendChild(link);
        }
      }

      injectJS(GFXTESTS_CONFIG.injectJS.path, GFXTESTS_CONFIG.injectJS.where, ()=> {
        console.log("Injected!");
      },
      () => {
        console.error("Error injecting JS!");
      }
      );
    }
    */

    /*
          if (typeof parameters['replay'] !== 'undefined' && GFXTESTS_CONFIG.input && !this.inputLoading) {
            this.inputLoading = true;
            fetch('/tests/' + GFXTESTS_CONFIG.input).then(response => {
              return response.json();
            })
            .then(json => {
              this.inputReplayer = new InputReplayer(this.canvas, json, this.eventListener.registeredEventListeners);
              this.inputHelpers = new InputHelpers(this.canvas);
              this.ready = true;
            });
*/

/*
    window.addEventListener('vrdisplaypresentchange', evt => {
      var display = evt.display;
      if (display.isPresenting) {
        this.unhookRAF(window);
        this.hookRAF(display);
      } else {
        this.unhookRAF(display);
        this.hookRAF(window);
      }
    });
*/
    Math.random = seedrandom(this.randomSeed);
    CanvasHook.enable(Object.assign({fakeWebGL: typeof parameters['fake-webgl'] !== 'undefined'}, {width: this.canvasWidth, height: this.canvasHeight}));
    this.hookModals();

    this.onResize();
    window.addEventListener('resize', this.onResize.bind(this));

    this.stats = new PerfStats();

    this.logs = {
      errors: [],
      warnings: [],
      catchErrors: []
    };
    // this.wrapErrors();

    this.eventListener = new EventListenerManager();

    //if (typeof parameters['recording'] !== 'undefined') {
    if (typeof parameters['recording'] === 'undefined') {
      this.eventListener.enable();
    }

    this.referenceTestFrameNumber = 0;

    this.timeStart = performance.realNow();
  },
  autoEnterXR: {
    requested: false,
    successful: false
  },
  XRsessions: [],
  injectAutoEnterXR: function(canvas) {
    this.autoEnterXR.requested = true;

    let prevRequestSession = navigator.xr.requestSession;
    WebXRHook.enable({
      onSessionStarted: session => {
        if (this.XRsessions.indexOf(session) === -1) {
          this.XRsessions.push(session);
          console.log('XRSession started', session);
          this.XRready = true;
          this.hookRAF(session);
          // window.requestAnimationFrame = () => {};
        }
      },
      onSessionEnded: session => {
        console.log('XRSession ended');
      }
    });



    /*
    if ('xr' in navigator) {
			navigator.xr.isSessionSupported( 'immersive-vr' ).then(supported => {
        if (supported) {
					var sessionInit = { optionalFeatures: [ 'local-floor', 'bounded-floor' ] };
					navigator.xr.requestSession( 'immersive-vr', sessionInit ).then( session => {

          });
        } else {
          this.processBenchmarkResult(this.generateFailedBenchmarkResult('autoenter-xr failed'));
        }
      });
      */
/*
      setTimeout(() => {
        navigator.getVRDisplays().then(displays => {
          var device = displays[0];
          //if (device.isPresenting) device.exitPresent();
          if (device) {
            device.requestPresent( [ { source: canvas } ] )
              .then(x => { console.log('autoenter XR successful'); this.autoEnterXR.successful = true; })
              .catch(x => {
                console.log('autoenter XR failed');
                if (this.mandatoryAutoEnterXR) {
                  setTimeout(x => {
                    this.processBenchmarkResult(this.generateFailedBenchmarkResult('autoenter-xr failed'));
                  },1000);
                }
              });
          }
        })
      }, 500); // @fix to make it work on FxR
    } else if (this.mandatoryAutoEnterXR) {
      setTimeout(x => {
        this.processBenchmarkResult(this.generateFailedBenchmarkResult('autoenter-xr failed'));
      },1000);
    }
    */
  },

  onResize: function (e) {
    if (e && e.origin === 'webgfxtest') return;

    const DEFAULT_WIDTH = 800;
    const DEFAULT_HEIGHT = 600;
    this.canvasWidth = DEFAULT_WIDTH;
    this.canvasHeight = DEFAULT_HEIGHT;

    if (typeof parameters['keep-window-size'] === 'undefined') {
      this.canvasWidth = typeof parameters['width'] === 'undefined' ? DEFAULT_WIDTH : parseInt(parameters['width']);
      this.canvasHeight = typeof parameters['height'] === 'undefined' ? DEFAULT_HEIGHT : parseInt(parameters['height']);
      window.innerWidth = this.canvasWidth;
      window.innerHeight = this.canvasHeight;
    }

    if (this.canvas) {
      this.canvas.width = this.canvasWidth;
      this.canvas.height = this.canvasHeight;
    }

    var e = document.createEventObject ? document.createEventObject() : document.createEvent("Events");
    if (e.initEvent) {
      e.initEvent('resize', true, true);
    }
    e.origin = 'webgfxtest';
    window.dispatchEvent ? window.dispatchEvent(e) : window.fireEvent("on" + eventType, e);
  }
};

TESTER.init();

var pageInitTime = performance.realNow();
