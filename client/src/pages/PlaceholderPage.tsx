interface Props {
  title: string
  body: string
}

export default function PlaceholderPage({ title, body }: Props) {
  return (
    <div>
      <div className="sticky top-0 z-10 border-b border-[#2f3336] bg-black/65 px-4 py-3 backdrop-blur">
        <h1 className="text-[20px] font-extrabold">{title}</h1>
      </div>
      <div className="flex flex-col items-center gap-2 px-8 py-20 text-center">
        <p className="text-[31px] font-extrabold">{title}</p>
        <p className="max-w-[380px] text-[15px] text-[#71767b]">{body}</p>
      </div>
    </div>
  )
}
