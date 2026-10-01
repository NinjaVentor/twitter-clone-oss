import { useState } from 'react'
import type { FormEvent } from 'react'
import SearchTypeahead from './SearchTypeahead'

interface Props {
  initial?: string
  placeholder?: string
  formClassName?: string
  inputClassName?: string
  onSubmit: (q: string) => void
}

/** Search input with live typeahead dropdown. Remount via key to reset. */
export default function SearchBox({
  initial = '',
  placeholder = 'Search',
  formClassName,
  inputClassName,
  onSubmit,
}: Props) {
  const [value, setValue] = useState(initial)
  const [focused, setFocused] = useState(false)

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (value.trim()) {
      setFocused(false)
      onSubmit(value.trim())
    }
  }

  return (
    <form onSubmit={submit} className={`relative ${formClassName ?? ''}`}>
      <label className="flex items-center gap-3 rounded-full border border-transparent bg-[#202327] px-4 py-2.5 focus-within:border-[#1d9bf0] focus-within:bg-black">
        <span className="text-[#71767b]">⌕</span>
        <input
          data-search-input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder={placeholder}
          className={`w-full bg-transparent text-[15px] outline-none placeholder:text-[#71767b] ${inputClassName ?? ''}`}
        />
      </label>
      {focused && value.trim() && (
        <SearchTypeahead query={value} onNavigate={() => setFocused(false)} />
      )}
    </form>
  )
}
