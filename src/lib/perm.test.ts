import { describe, expect, it } from 'vitest'
import { canManageRole, canManageUser, gradeEditBlock, gradeEditBlockR2, manageableRoles, workflowActions } from './perm'
import type { Role } from './types'

const who = (role: Role, department_id: string | null = null, id = `u-${role}`) => ({ id, role, department_id })
type St = 'draft' | 'submitted' | 'returned' | 'approved'
const subject = (status: St = 'draft', r2_status: St = 'draft') => ({ department_id: 'rad', teacher_ids: ['t1'], status, r2_status })
const open = { entry_open: true }
const closed = { entry_open: false }

describe('gradeEditBlock', () => {
  it('lets the assigned teacher edit a draft while entry is open', () => {
    expect(gradeEditBlock(who('teacher', 'rad', 't1'), subject(), open, open)).toBeNull()
  })
  it('blocks teachers not assigned to the subject', () => {
    expect(gradeEditBlock(who('teacher', 'rad', 't2'), subject(), open, open)).toMatch(/صلاحية/)
  })
  it('blocks heads of other departments', () => {
    expect(gradeEditBlock(who('head', 'ans'), subject(), open, open)).toMatch(/صلاحية/)
    expect(gradeEditBlock(who('head', 'rad'), subject(), open, open)).toBeNull()
  })
  it('blocks everyone except senior management when entry is closed', () => {
    expect(gradeEditBlock(who('teacher', 'rad', 't1'), subject(), closed, open)).toMatch(/مغلق/)
    expect(gradeEditBlock(who('head', 'rad'), subject(), open, closed)).toMatch(/مغلق لهذا القسم/)
    expect(gradeEditBlock(who('assistant_dean'), subject(), closed, closed)).toBeNull()
    expect(gradeEditBlock(who('admin'), subject('approved'), closed, open)).toBeNull()
  })
  it('blocks edits after submission or approval', () => {
    expect(gradeEditBlock(who('teacher', 'rad', 't1'), subject('submitted'), open, open)).toMatch(/مرسلة/)
    expect(gradeEditBlock(who('teacher', 'rad', 't1'), subject('approved'), open, open)).toMatch(/معتمدة/)
    expect(gradeEditBlock(who('teacher', 'rad', 't1'), subject('returned'), open, open)).toBeNull()
  })
  it('never lets the committee edit grades', () => {
    expect(gradeEditBlock(who('committee'), subject(), open, open)).toMatch(/صلاحية/)
  })
})

describe('workflowActions', () => {
  it('committee approves or returns submitted sheets only', () => {
    expect(workflowActions(who('committee'), subject('submitted'), open, open)).toMatchObject({ approve: true, giveBack: true, toDraft: false })
    expect(workflowActions(who('committee'), subject('draft'), open, open)).toMatchObject({ approve: false, giveBack: false })
    expect(workflowActions(who('committee'), subject('approved'), open, open).giveBack).toBe(false)
  })
  it('senior management can reopen approved sheets', () => {
    expect(workflowActions(who('dean'), subject('approved'), open, open)).toMatchObject({ giveBack: true, toDraft: true })
  })
  it('teacher submits drafts but not after closing', () => {
    expect(workflowActions(who('teacher', 'rad', 't1'), subject('draft'), open, open).submit).toBe(true)
    expect(workflowActions(who('teacher', 'rad', 't1'), subject('draft'), closed, open).submit).toBe(false)
  })
})

describe('second round', () => {
  it('opens round-2 entry only after round 1 is approved', () => {
    const t = who('teacher', 'rad', 't1')
    expect(gradeEditBlockR2(t, subject('submitted'), open, open)).toMatch(/اعتماد نتائج الدور الأول/)
    expect(gradeEditBlockR2(t, subject('approved'), open, open)).toBeNull()
    expect(gradeEditBlockR2(t, subject('approved', 'submitted'), open, open)).toMatch(/الدور الثاني مرسلة/)
    expect(gradeEditBlockR2(t, subject('approved'), closed, open)).toMatch(/مغلق/)
  })
  it('has its own workflow', () => {
    const t = who('teacher', 'rad', 't1')
    expect(workflowActions(t, subject('approved'), open, open, 2).submit).toBe(true)
    expect(workflowActions(t, subject('approved'), open, open, 1).submit).toBe(false)
    expect(workflowActions(who('committee'), subject('approved', 'submitted'), open, open, 2).approve).toBe(true)
    expect(workflowActions(who('committee'), subject('draft', 'submitted'), open, open, 2).approve).toBe(false)
  })
})

describe('account management', () => {
  it('follows the role hierarchy', () => {
    expect(manageableRoles(who('admin'))).toContain('admin')
    expect(manageableRoles(who('dean'))).not.toContain('admin')
    expect(manageableRoles(who('assistant_dean'))).toEqual(['committee', 'head', 'teacher'])
    expect(manageableRoles(who('teacher'))).toEqual([])
  })
  it('limits heads to teachers of their own department', () => {
    const head = who('head', 'rad')
    expect(canManageRole(head, 'teacher', 'rad')).toBe(true)
    expect(canManageRole(head, 'teacher', 'ans')).toBe(false)
    expect(canManageRole(head, 'head', 'rad')).toBe(false)
    expect(canManageUser(head, who('teacher', 'rad', 'x'))).toBe(true)
    expect(canManageUser(head, who('teacher', 'ans', 'y'))).toBe(false)
  })
  it('never manages own account through admin tools', () => {
    const a = who('admin')
    expect(canManageUser(a, a)).toBe(false)
  })
})
