const LETTERS = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ'
const DIGITS = '23456789'

function pick(chars: string, n: number): string {
  const buf = new Uint32Array(n)
  crypto.getRandomValues(buf)
  return Array.from(buf, (x) => chars[x % chars.length]).join('')
}

/** كلمة مرور مؤقتة سهلة القراءة (بدون أحرف ملتبسة مثل 0/O و 1/l) */
export function generatePassword(): string {
  return `${pick(LETTERS, 4)}${pick(DIGITS, 4)}`
}

export const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{2,31}$/

export function suggestUsername(prefix: string, taken: Set<string>, start = 1): string {
  const base = prefix.toLowerCase().replace(/[^a-z0-9._-]/g, '') || 'user'
  for (let i = start; i < 10000; i++) {
    const u = `${base}${String(i).padStart(2, '0')}`
    if (!taken.has(u)) return u
  }
  return `${base}${Date.now()}`
}

export const USERNAME_DOMAIN = 'exam.local'
export const usernameToEmail = (u: string) => `${u.trim().toLowerCase()}@${USERNAME_DOMAIN}`
