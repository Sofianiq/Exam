import { describe, expect, it } from 'vitest'
import { normalizeArabic, parseClipboardGrid, parseGradeInput, parseNameList, parsePlanRows, splitDuplicates } from './parse'

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

describe('parsePlanRows', () => {
  it('reads rows copied from the study-plan table in Word', () => {
    const text = [
      'ت\tاسم المادة\tLecture name\tنوعها\tلغة التدريس\tن\tع\tالمجموع\tعدد الوحدات',
      '1\tعلم التغذية 1\tNutrition 1\tتخصصية / اساسية\tEnglish\t2\t4\t6\t4',
      '3\tعلم الدوائيات 1\tPharmacology 1\tتخصصية / مساعدة\tEnglish\t2\t2\t4\t3',
      '7\tجرائم نظام البعث في العراق\tCrimes of The Baath Regime in Iraq\tعامة\tالعربية\t2\t-\t2\t2',
      '\t\t\t\t\t14\t20\t34\t24',
    ].join('\n')
    expect(parsePlanRows(text)).toEqual([
      { name: 'علم التغذية 1', name_en: 'Nutrition 1', category: 'تخصصية / اساسية', language: 'English', theory_hours: 2, practical_hours: 4, units: 4, ministerial: false },
      { name: 'علم الدوائيات 1', name_en: 'Pharmacology 1', category: 'تخصصية / مساعدة', language: 'English', theory_hours: 2, practical_hours: 2, units: 3, ministerial: false },
      { name: 'جرائم نظام البعث في العراق', name_en: 'Crimes of The Baath Regime in Iraq', category: 'عامة', language: 'العربية', theory_hours: 2, practical_hours: 0, units: 2, ministerial: false },
    ])
  })
})
