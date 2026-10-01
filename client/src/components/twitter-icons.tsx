import type { ReactNode, SVGProps } from 'react'
import {
  ArrowsRightLeftIcon as RetweetOutline,
  ArrowUpTrayIcon as ShareOutline,
  BellIcon as BellOutline,
  BookmarkIcon as BookmarkOutline,
  ChartBarIcon as ViewsOutline,
  ChatBubbleOvalLeftIcon as ReplyOutline,
  EnvelopeIcon as EnvelopeOutline,
  FaceSmileIcon as EmojiOutline,
  GifIcon as GifOutline,
  HashtagIcon as HashtagOutline,
  HeartIcon as HeartOutline,
  HomeIcon as HomeOutline,
  MagnifyingGlassIcon as SearchOutline,
  PhotoIcon as MediaOutline,
  ChartBarSquareIcon as PollOutline,
  SparklesIcon as SparklesOutline,
  UserIcon as UserOutline,
} from '@heroicons/react/24/outline'
import {
  ArrowsRightLeftIcon as RetweetSolid,
  ArrowUpTrayIcon as ShareSolid,
  BellIcon as BellSolid,
  BookmarkIcon as BookmarkSolid,
  ChartBarIcon as ViewsSolid,
  ChatBubbleOvalLeftIcon as ReplySolid,
  EnvelopeIcon as EnvelopeSolid,
  FaceSmileIcon as EmojiSolid,
  HashtagIcon as HashtagSolid,
  HeartIcon as HeartSolid,
  HomeIcon as HomeSolid,
  UserIcon as UserSolid,
} from '@heroicons/react/24/solid'

type HeroIcon = (props: SVGProps<SVGSVGElement>) => ReactNode

interface ActiveIconProps {
  className?: string
  /** Solid filled variant when true (Twitter's active nav state). */
  active?: boolean
}

interface FilledIconProps {
  className?: string
  filled?: boolean
}

interface PlainIconProps {
  className?: string
}

function swap(Outline: HeroIcon, Solid: HeroIcon, className: string | undefined, on: boolean | undefined) {
  const Cmp = on ? Solid : Outline
  return <Cmp className={className} aria-hidden="true" />
}

function plain(Cmp: HeroIcon, className: string | undefined) {
  return <Cmp className={className} aria-hidden="true" />
}

/** Left Sidebar nav icons — outline when inactive, solid when active. */
export function TwitterHomeIcon({ className, active }: ActiveIconProps) {
  return swap(HomeOutline, HomeSolid, className, active)
}
export function TwitterExploreIcon({ className, active }: ActiveIconProps) {
  return swap(HashtagOutline, HashtagSolid, className, active)
}
export function TwitterNotificationsIcon({ className, active }: ActiveIconProps) {
  return swap(BellOutline, BellSolid, className, active)
}
export function TwitterMessagesIcon({ className, active }: ActiveIconProps) {
  return swap(EnvelopeOutline, EnvelopeSolid, className, active)
}
export function TwitterBookmarksIcon({ className, active }: ActiveIconProps) {
  return swap(BookmarkOutline, BookmarkSolid, className, active)
}
export function TwitterProfileIcon({ className, active }: ActiveIconProps) {
  return swap(UserOutline, UserSolid, className, active)
}

/** Tweet action bar icons (outline; filled when engaged). */
export function TwitterReplyIcon({ className, active }: ActiveIconProps) {
  return swap(ReplyOutline, ReplySolid, className, active)
}
export function TwitterRetweetIcon({ className, active }: ActiveIconProps) {
  return swap(RetweetOutline, RetweetSolid, className, active)
}
export function TwitterLikeIcon({ className, filled }: FilledIconProps) {
  return swap(HeartOutline, HeartSolid, className, filled)
}
export function TwitterViewsIcon({ className, active }: ActiveIconProps) {
  return swap(ViewsOutline, ViewsSolid, className, active)
}
export function TwitterShareIcon({ className, active }: ActiveIconProps) {
  return swap(ShareOutline, ShareSolid, className, active)
}
export function TwitterBookmarkActionIcon({ className, filled }: FilledIconProps) {
  return swap(BookmarkOutline, BookmarkSolid, className, filled)
}

/** Composer toolbar + misc Twitter icons (outline only). */
export function TwitterMediaIcon({ className }: PlainIconProps) {
  return plain(MediaOutline, className)
}
export function TwitterGifIcon({ className }: PlainIconProps) {
  return plain(GifOutline, className)
}
export function TwitterPollIcon({ className }: PlainIconProps) {
  return plain(PollOutline, className)
}
export function TwitterEmojiIcon({ className }: PlainIconProps) {
  return plain(EmojiOutline, className)
}
export function TwitterEmojiIconFilled({ className }: PlainIconProps) {
  return plain(EmojiSolid, className)
}
export function TwitterSparklesIcon({ className }: PlainIconProps) {
  return plain(SparklesOutline, className)
}
export function TwitterSearchIcon({ className }: PlainIconProps) {
  return plain(SearchOutline, className)
}
