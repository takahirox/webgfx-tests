function WebGLTextureHook() {
  var stats = {
    numTextureUploads: 0,
    numTextureUploadFrames: 0,
    numTexImage2DCalls: 0,
    totalUploadTime: 0.0
  };

  var currentTime = 0.0;
  var uploadingTexture = false;

  function _h (f, c) {
    return function () {
      c.apply(this, arguments);
      f.apply(this, arguments);
    };
  }

  function enable(time) {
    this.currentTime = time;
    if (window.WebGL2RenderingContext) {
      WebGL2RenderingContext.prototype.texImage2D = _h( WebGL2RenderingContext.prototype.texImage2D, function () {
        stats.numTexImage2DCalls++;
        stats.numTextureUploads++;
        uploadingTexture = true;
      });
    }

    WebGLRenderingContext.prototype.texImage2D = _h( WebGLRenderingContext.prototype.texImage2D, function () {
      stats.numTexImage2DCalls++;
      stats.numTextureUploads++;
      uploadingTexture = true;
    });
  }

  function frameStart(time) {
    if (uploadingTexture) {
      stats.numTextureUploadFrames++;
      stats.totalUploadTime += time - currentTime;
      uploadingTexture = false;
    }
    currentTime = time;
  }

  function getSummary() {
    var result = Object.assign( {}, stats );
    result.avgUploadTime = result.totalUploadTime / result.numTextureUploads;
    result.uploadTimePerFrame = result.totalUploadTime / result.numTextureUploadFrames;
    result.avgFps = 1000.0 / result.uploadTimePerFrame;
    return result;
  }

  return {
    enable: enable,
    frameStart: frameStart,
    getSummary: getSummary
  };
}

export default WebGLTextureHook();
