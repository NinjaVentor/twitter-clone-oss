declare module 'twemoji-parser' {
  export interface EmojiEntity {
    url: string
    text: string
    indices: [number, number]
  }

  export interface ParseOptions {
    assetType?: 'svg' | 'png'
    buildUrl?: (codepoints: string, assetType: string) => string
  }

  export function parse(text: string, options?: ParseOptions): EmojiEntity[]
}
