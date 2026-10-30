import { Eye, EyeOff, LogIn, ShieldCheck } from 'lucide-react'
import { useState } from 'react'
import { useTheme } from '../app/hooks'
import { errorText } from '../components/feedback'
import { Button, Callout, Field, Input } from '../components/ui'
import { backend, isDemo } from '../data'
import { DEMO_ACCOUNTS, DEMO_PASSWORD } from '../data/demoSeed'
import { ROLE_LABEL } from '../lib/labels'
import type { Profile } from '../lib/types'

export function LoginPage({ onLogin, notice }: { onLogin: (p: Profile) => void; notice?: string | null }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  useTheme()

  const login = async (u = username, p = password) => {
    setErr(null)
    if (!u.trim() || !p) return setErr('يرجى إدخال اسم المستخدم وكلمة المرور')
    setBusy(true)
    try {
      onLogin(await backend.signIn(u, p))
    } catch (e) {
      setErr(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid min-h-dvh lg:grid-cols-[1fr_1.1fr]">
      <div className="flex items-center justify-center px-4 py-10 sm:px-8">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex flex-col items-center text-center lg:hidden">
            <img src="./logo.png" alt="شعار الكلية" className="size-24 drop-shadow" />
            <h1 className="mt-3 text-xl font-bold">نظام اللجنة الامتحانية</h1>
            <p className="mt-1 text-sm text-muted">كلية التقنيات الصحية والطبية — جامعة السراج الأهلية</p>
          </div>
          <h2 className="hidden text-2xl font-bold lg:block">تسجيل الدخول</h2>
          <p className="mt-1 hidden text-sm text-muted lg:block">أدخل بيانات حسابك للمتابعة</p>

          <form
            className="mt-6 space-y-4"
            onSubmit={(e) => {
              e.preventDefault()
              void login()
            }}
          >
            {notice && <Callout tone="info">{notice}</Callout>}
            <Field label="اسم المستخدم">
              <Input
                autoFocus
                dir="ltr"
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="username"
                className="h-11 text-left"
              />
            </Field>
            <Field label="كلمة المرور" error={err}>
              <div className="relative">
                <Input
                  type={show ? 'text' : 'password'}
                  dir="ltr"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="h-11 pe-11 text-left"
                />
                <button
                  type="button"
                  onClick={() => setShow((v) => !v)}
                  className="absolute inset-y-0 end-0 flex w-11 items-center justify-center text-muted hover:text-ink"
                  aria-label={show ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'}
                >
                  {show ? <EyeOff className="size-4.5" /> : <Eye className="size-4.5" />}
                </button>
              </div>
            </Field>
            <Button type="submit" variant="primary" size="lg" className="w-full" loading={busy} icon={<LogIn className="size-4.5" />}>
              دخول
            </Button>
            <p className="flex items-center justify-center gap-1.5 text-xs text-muted">
              <ShieldCheck className="size-3.5" /> نسيت كلمة المرور؟ تواصل مع مقرر القسم أو إدارة النظام
            </p>
          </form>

          {isDemo && (
            <div className="mt-8 rounded-xl border border-gold/40 bg-gold-soft p-4">
              <div className="text-sm font-semibold text-gold-text">نسخة تجريبية — اختر حساباً للدخول السريع</div>
              <p className="mt-1 text-xs text-gold-text/80">
                كلمة المرور لجميع الحسابات: <b dir="ltr">{DEMO_PASSWORD}</b>
              </p>
              <div className="mt-3 grid grid-cols-2 gap-2">
                {DEMO_ACCOUNTS.map((a) => (
                  <button
                    key={a.username}
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      setUsername(a.username)
                      setPassword(DEMO_PASSWORD)
                      void login(a.username, DEMO_PASSWORD)
                    }}
                    className="rounded-lg border border-line bg-surface px-3 py-2 text-start transition hover:border-primary hover:shadow-sm disabled:opacity-50"
                  >
                    <div className="text-sm font-semibold">{ROLE_LABEL[a.role]}</div>
                    <div className="text-[0.7rem] text-muted">{a.hint}</div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="relative hidden overflow-hidden bg-gradient-to-br from-[#083a27] via-[#0b5a3a] to-[#0d6a45] text-white lg:flex lg:flex-col lg:items-center lg:justify-center lg:px-12">
        <div className="pointer-events-none absolute -top-32 -start-32 size-96 rounded-full border-[40px] border-white/5" />
        <div className="pointer-events-none absolute -bottom-40 -end-24 size-[28rem] rounded-full border-[56px] border-[#d6ad55]/10" />
        <img src="./logo.png" alt="شعار كلية التقنيات الصحية والطبية" className="relative size-44 drop-shadow-2xl" />
        <h1 className="relative mt-8 text-center text-3xl font-bold leading-snug">نظام إدارة اللجنة الامتحانية</h1>
        <p className="relative mt-2 text-center text-lg text-white/80">كلية التقنيات الصحية والطبية — جامعة السراج الأهلية</p>
        <div className="relative mt-10 grid w-full max-w-lg grid-cols-3 gap-3 text-center text-sm">
          {['إدخال الدرجات', 'التدقيق والاعتماد', 'النتائج والتقارير'].map((t) => (
            <div key={t} className="rounded-xl border border-white/15 bg-white/5 px-3 py-3 backdrop-blur">
              {t}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
