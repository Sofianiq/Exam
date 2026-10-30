import { describe, expect, it } from 'vitest'
import { normalizeArabic, parseClipboardGrid, parseGradeInput, parseNameList, splitDuplicates } from './parse'

describe('parseNameList', () => {
  it('keeps the pasted order and cleans spaces', () => {
    expect(parseNameList('  زينب  علي حسين \n\nاحمد   كريم جواد\r\n')).toEqual(['زينب علي حسين', 'احمد كريم جواد'])
  })
  it('accepts two columns copied from Excel (sequence + name)', () => {
    expect(parseNameList('1\tاحمد كريم جواد سعد\n2\tعلي حسن كاظم جاسم')).toEqual(['احمد كريم جواد سعد', 'علي حسن كاظم جاسم'])
  })
  it('strips leading numbering in Latin or Arabic digits', () => {
    expect(parseNameList('١- مريم سعد كاظم\n12. علي كريم جواد\n3) نور هادي')).toEqual(['مريم سعد كاظم', 'علي كريم جواد', 'نور هادي'])
  })
  it('ignores header rows and rows without letters', () => {
    expect(parseNameList('ت\tاسم الطالب\n1\t\n\t\n2\tعلي حسن')).toEqual(['علي حسن'])
  })
})

describe('splitDuplicates', () => {
  it('detects duplicates despite hamza/taa marbuta differences', () => {
    const r = splitDuplicates(['أحمد علي', 'فاطمة حسن', 'فاطمه حسن', 'زيد'], ['احمد علي'])
    expect(r.fresh).toEqual(['فاطمة حسن', 'زيد'])
    expect(r.dup).toEqual(['أحمد علي', 'فاطمه حسن'])
  })
  it('normalizes Arabic', () => {
    expect(normalizeArabic('إسراء  مُحسّن')).toBe('اسراء محسن')
  })
})

describe('parseGradeInput', () => {
  it('parses numbers including Arabic-Indic digits and decimal comma', () => {
    expect(parseGradeInput('17', 25)).toEqual({ kind: 'number', value: 17 })
    expect(parseGradeInput('١٧٫٥', 25)).toEqual({ kind: 'number', value: 17.5 })
    expect(parseGradeInput('12,25', 25)).toEqual({ kind: 'number', value: 12.25 })
  })
  it('rejects values above the maximum, non-numbers and >2 decimals', () => {
    expect(parseGradeInput('26', 25).kind).toBe('error')
    expect(parseGradeInput('abc', 25).kind).toBe('error')
    expect(parseGradeInput('1.234', 25).kind).toBe('error')
    expect(parseGradeInput('-3', 25).kind).toBe('error')
  })
  it('recognizes special codes', () => {
    expect(parseGradeInput('غ', 25)).toEqual({ kind: 'special', code: 'absent' })
    expect(parseGradeInput('غائب', 25)).toEqual({ kind: 'special', code: 'absent' })
    expect(parseGradeInput('ح', 25)).toEqual({ kind: 'special', code: 'banned' })
    expect(parseGradeInput('مؤجل', 25)).toEqual({ kind: 'special', code: 'postponed' })
  })
  it('treats blanks as empty', () => {
    expect(parseGradeInput('  ', 25)).toEqual({ kind: 'empty' })
  })
})

describe('parseClipboardGrid', () => {
  it('splits Excel clipboard data into rows and cells', () => {
    expect(parseClipboardGrid('17\t13\r\n11\t9\r\n')).toEqual([
      ['17', '13'],
      ['11', '9'],
    ])
  })
})
