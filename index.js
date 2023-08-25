function Recorder(config) {
  // 配置
  this.config = Object.assign(
    {
      sampleBits: 16, // 采样位数 8, 16
      sampleRate: 16000, // 采样率16khz 16000
      bufferSize: 2048, // 录音缓存大小 1024/2048/4096
      inputChannels: 1, // 输入声道数
      outputChannels: 1, // 输出声道数
      inputSampleRate: 48000, // 音频输入的采样率
    },
    config || {}
  );

  this.initAudio = async () => {
    // 初始化录音，录音音频流回调
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        sampleRate: this.config.inputSampleRate,
        sampleSize: this.config.sampleBits,
        channelCount: this.config.inputChannels,
      },
    });
    this.context = new (window.webkitAudioContext || window.AudioContext)({
      sampleRate: this.config.inputSampleRate,
    });
    this.audioInput = this.context.createMediaStreamSource(this.stream); // 音频流
    const createScript = this.context.createScriptProcessor || this.context.createJavaScriptNode;
    this.recorder = createScript.apply(this.context, [
      this.config.bufferSize,
      this.config.inputChannels,
      this.config.outputChannels,
    ]);

    // 音频输入采样率
    this.config.inputSampleRate = this.context.sampleRate;
    this.config.buffer = []; // 录音缓存 [Float32Array, Float32Array, Float32Array]
    this.config.totalLength = 0; // buffer 中所有 Float32Array 总和

    console.log(this.config);

    // 音频采集
    this.recorder.onaudioprocess = (event) => {
      const data = event.inputBuffer.getChannelData(0);
      this.config.buffer.push(new Float32Array(data));
      this.config.totalLength += data.length;
    };
  };

  // 开始录音
  this.start = () => {
    this.audioInput.connect(this.recorder);
    this.recorder.connect(this.context.destination);
  };

  // 停止
  this.stop = () => {
    this.recorder.disconnect();
  };

  // 销毁
  this.destroy = () => {
    const tracks = this.stream.getAudioTracks();
    for (let i = 0; i < tracks.length; i++) {
      tracks[i].enabled = false;
      tracks[i].stop();
    }
  };

  this.getConfig = () => {
    return this.config;
  };

  this.clearBuffer = () => {
    this.config.buffer = [];
    this.config.totalLength = 0;
  };

  // 获取所有音频数据
  this.getAllBytes = () => {
    // 合并：二维数组转一维数组
    const data = new Float32Array(this.config.totalLength);
    let offset = 0;
    for (let i = 0; i < this.config.buffer.length; i++) {
      data.set(this.config.buffer[i], offset);
      offset += this.config.buffer[i].length;
    }
    // 音频输入和输出采样率不一致，压缩
    return compress(data, this.config.inputSampleRate, this.config.sampleRate);
  };

  // 根据下标获取音频数据
  this.getBufferBytes = (index) => {
    if (this.config.buffer.length <= index) {
      return null;
    }
    // 获取一个一维数组，大小为 bufferSize，压缩过后大小为 bufferSize / (inputSampleRate / sampleRate)，48k/16k=3，大小为 bufferSize/3
    // 音频输入和输出采样率不一致，压缩
    return compress(this.config.buffer[index], this.config.inputSampleRate, this.config.sampleRate);
  };

  // wav
  this.encodeWavBlob = (bytes) => {
    if (bytes == null) {
      bytes = this.getAllBytes();
    }
    return encodeWavBlob(bytes, this.config.outputChannels, this.config.sampleBits, this.config.sampleRate);
  };

  // pcm dataView
  this.toPCMDataView = (bytes) => {
    const sampleBits = this.config.sampleBits;
    const dataLength = bytes.length * (sampleBits / 8);
    const buffer = new ArrayBuffer(dataLength);
    const dataView = new DataView(buffer);
    writePCMBytes(dataView, 0, bytes, sampleBits);
    return dataView;
  };

  // pcm base64
  this.toPCMBase64 = (bytes, callback) => {
    return new Promise((rev, rej) => {
      try {
        const blob = new Blob([this.toPCMDataView(bytes)]);
        const reader = new FileReader();
        reader.onload = function (event) {
          callback?.(event.target.result);
          rev(event.target.result);
        };
        reader.readAsDataURL(blob);
      } catch (e) {
        rej(e);
      }
    });
  };
}

Recorder.check = () => {
  try {
    // 检查是否能够调用麦克风
    window.AudioContext = window.AudioContext || window.webkitAudioContext;
    navigator.getUserMedia = navigator.getUserMedia || navigator.webkitGetUserMedia;
    window.URL = window.URL || window.webkitURL;
    new AudioContext();
    return !!navigator.getUserMedia;
  } catch (e) {
    return false;
  }
};

// wav 格式
function encodeWavBlob(bytes, channelCount, sampleBits, sampleRate) {
  const dataLength = bytes.length * (sampleBits / 8);
  const buffer = new ArrayBuffer(44 + dataLength);
  const data = new DataView(buffer);
  let offset = 0;
  const writeString = function (str) {
    for (let i = 0; i < str.length; i++) {
      data.setUint8(offset + i, str.charCodeAt(i));
    }
  };
  // 资源交换文件标识符
  writeString("RIFF");
  offset += 4;
  // 下个地址开始到文件尾总字节数,即文件大小-8
  data.setUint32(offset, 36 + dataLength, true);
  offset += 4;
  // WAV文件标志
  writeString("WAVE");
  offset += 4;
  // 波形格式标志
  writeString("fmt ");
  offset += 4;
  // 过滤字节,一般为 0x10 = 16
  data.setUint32(offset, 16, true);
  offset += 4;
  // 格式类别 (PCM形式采样数据)
  data.setUint16(offset, 1, true);
  offset += 2;
  // 通道数
  data.setUint16(offset, channelCount, true);
  offset += 2;
  // 采样率,每秒样本数,表示每个通道的播放速度
  data.setUint32(offset, sampleRate, true);
  offset += 4;
  // 波形数据传输率 (每秒平均字节数) 单声道×每秒数据位数×每样本数据位/8
  data.setUint32(offset, channelCount * sampleRate * (sampleBits / 8), true);
  offset += 4;
  // 快数据调整数 采样一次占用字节数 单声道×每样本的数据位数/8
  data.setUint16(offset, channelCount * (sampleBits / 8), true);
  offset += 2;
  // 每样本数据位数
  data.setUint16(offset, sampleBits, true);
  offset += 2;
  // 数据标识符
  writeString("data");
  offset += 4;
  // 采样数据总数,即数据总大小-44
  data.setUint32(offset, dataLength, true);
  offset += 4;
  // 写入采样数据
  writePCMBytes(data, offset, bytes, sampleBits);
  return new Blob([data], {
    type: "audio/wav",
  });
}

// 压缩，采样率转换
function compress(bytes, inputSampleRate, outputSampleRate) {
  if (inputSampleRate !== outputSampleRate) {
    const compression = parseInt(inputSampleRate / outputSampleRate);
    const length = bytes.length / compression;
    const result = new Float32Array(length);
    let j = 0;
    let index = 0;
    while (index < length) {
      result[index] = bytes[j];
      j += compression;
      index++;
    }
    bytes = result;
  }
  return bytes;
}

// pcm 数据按量化位数处理
function writePCMBytes(dataView, offset, bytes, sampleBits) {
  // 写入采样数据
  if (sampleBits === 8) {
    // 采样位数如果是8，范围是-128~127整体先上平移128(+128)
    for (let i = 0; i < bytes.length; i++, offset++) {
      // 范围[-1,1]
      const s = Math.max(-1, Math.min(1, bytes[i]));
      let val = s < 0 ? s * 128 : s * 127;
      val = parseInt(val + 128);
      dataView.setInt8(offset, val);
    }
  } else {
    // 当是16位的，只需要对负数*32768,对正数*32767就行了，offset取2，并使用setInt16，第三个参数要置为true，牵扯到大端和小端字节序
    for (let j = 0; j < bytes.length; j++, offset += 2) {
      // 范围[-1,1]
      const s = Math.max(-1, Math.min(1, bytes[j]));
      dataView.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    }
  }
}

export default Recorder;

export { Recorder };
