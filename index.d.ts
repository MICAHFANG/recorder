export type RecorderOptions = Partial<{
  sampleBits: number;
  sampleRate: number;
  bufferSize: number;
  inputChannels: number;
  outputChannels: number;
  inputSampleRate: number; // 音频输入的采样率
}>;

export class Recorder {
  constructor(config: RecorderOptions);

  static check(): boolean;
  initAudio(): Promise<void>;
  start(): void;
  stop(): void;
  destroy(): void;
  getConfig(): RecorderOptions;
  clearBuffer(): void;
  getAllBytes(): Blob;
  getBufferBytes(index: number): Blob;
  encodeWavBlob(bytes: Blob): Blob;
  toPCMDataView(bytes: Blob): DataView;
  toPCMBase64(bytes: Blob, cb?: (b: string) => void): Promise<string>;
}

export default Recorder;
