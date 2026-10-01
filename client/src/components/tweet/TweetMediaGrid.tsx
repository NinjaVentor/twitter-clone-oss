import { useState } from 'react'
import Lightbox from 'yet-another-react-lightbox'
import 'yet-another-react-lightbox/styles.css'

interface Props {
  urls: string[]
}

function isVideo(url: string) {
  return /\.(mp4|webm|mov|m4v)(\?|$)/i.test(url)
}

function gridClass(n: number) {
  if (n === 1) return 'grid-cols-1'
  return 'grid-cols-2'
}

/** 1-4 media bento grid with lightbox. Videos render inline as <video>. */
export default function TweetMediaGrid({ urls }: Props) {
  const [lightbox, setLightbox] = useState(-1)
  if (urls.length === 0) return null
  const images = urls.filter((u) => !isVideo(u))
  const videos = urls.filter((u) => isVideo(u))

  return (
    <div
      className="overflow-hidden rounded-2xl border border-[#2f3336]"
      onClick={(e) => e.stopPropagation()}
    >
      {videos.length > 0 && (
        <video
          src={videos[0]}
          controls
          playsInline
          preload="metadata"
          className="max-h-[510px] w-full bg-black"
        />
      )}
      {images.length > 0 && (
        <div className={`grid max-h-[510px] gap-0.5 overflow-hidden ${gridClass(images.length)}`}>
          {images.slice(0, 4).map((u, i) => {
            const n = Math.min(images.length, 4)
            let cls = 'h-full w-full object-cover'
            if (n === 1) cls += ' max-h-[510px]'
            else if (n === 2) cls += ' aspect-[16/9]'
            else if (n === 3 && i === 0) cls += ' row-span-2 h-full min-h-[280px]'
            else cls += ' aspect-[16/9]'
            return (
              <button
                key={u}
                type="button"
                onClick={() => setLightbox(i)}
                className={`block overflow-hidden ${n === 3 && i === 0 ? 'row-span-2' : ''}`}
              >
                <img src={u} alt="" loading="lazy" className={cls} draggable={false} />
              </button>
            )
          })}
        </div>
      )}
      <Lightbox
        open={lightbox >= 0}
        index={lightbox}
        close={() => setLightbox(-1)}
        slides={images.map((src) => ({ src }))}
      />
    </div>
  )
}
