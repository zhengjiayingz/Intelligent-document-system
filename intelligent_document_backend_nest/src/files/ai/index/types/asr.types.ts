export type AsrSegment = {
  text: string; // 这一句的文字
  startMs: number;
  endMs: number;
};

export type AsrTranscript = {
  text: string; // 整段转写的全文
  segments: AsrSegment[];
  /** 媒体时长（毫秒）；探测失败时可为 0 */
  durationMs: number;
};
