import { useQuery } from '@tanstack/react-query'
import { useCallback, useSyncExternalStore } from 'react'
import { backend } from '../data'
import type { Announcement, AnnouncementAudience, AnnouncementLevel, Profile } from '../lib/types'
import { isSuper } from '../lib/perm'

export const LEVEL_LABEL: Record<AnnouncementLevel, string> = { info: 'عادي', important: 'مهم', urgent: 'عاجل' }
export const AUDIENCE_LABEL: Record<AnnouncementAudience, string> = { all: 'جميع المستخدمين', teachers: 'التدريسيون ومقررو الأقسام', heads: 'مقررو الأقسام فقط' }

export const canPublishAnnouncements = (p: Profile) => isSuper(p) || (p.role === 'head' && !!p.department_id)
export const canEditAnnouncement = (p: Profile, a: Announcement) => isSuper(p) || (p.role === 'head' && a.created_by === p.id)

export const useAnnouncements = (enabled = true) =>
  useQuery({ queryKey: ['announcements'], queryFn: () => backend.listAnnouncements(), enabled, refetchInterval: 5 * 60_000 })

/** الإعلانات النافذة (غير المنتهية) — المنتهية تبقى ظاهرة لكاتبها والإدارة في صفحة الإعلانات فقط */
export const isActive = (a: Announcement) => !a.expires_at || new Date(a.expires_at) > new Date()

// ما قرأه المستخدم يُحفظ في هذا المتصفح فقط (ميزة شخصية لا تحتاج قاعدة بيانات)
const KEY = (uid: string) => `exam.ann.seen.${uid}`
const listeners = new Set<() => void>()
const read = (uid: string): string => {
  try {
    return localStorage.getItem(KEY(uid)) ?? ''
  } catch {
    return ''
  }
}

export function useSeenAnnouncements(uid: string) {
  const raw = useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => read(uid),
  )
  const seen = new Set(raw ? raw.split(',') : [])
  const markSeen = useCallback(
    (ids: string[]) => {
      const cur = new Set(read(uid).split(',').filter(Boolean))
      ids.forEach((id) => cur.add(id))
      try {
        localStorage.setItem(KEY(uid), [...cur].slice(-300).join(','))
      } catch {
        /* التخزين غير متاح: يبقى الإعلان ظاهراً */
      }
      listeners.forEach((l) => l())
    },
    [uid],
  )
  return { seen, markSeen }
}
