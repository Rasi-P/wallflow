export function localDay(date = new Date()) {
  const year = String(date.getFullYear()).padStart(4, '0')
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function isDueDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  if (year < 1 || month < 1 || month > 12 || day < 1) return false
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  return day <= days[month - 1]
}

export function dueStatus(date: string, today: string) {
  return date < today ? 'overdue' : date === today ? 'today' : 'upcoming'
}

const shortDate = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' })
const fullDate = new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' })

export function formatDueDate(value: string, today: string) {
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(0)
  // Use UTC only for formatting the validated calendar fields. The stored date has no time zone.
  date.setUTCFullYear(year, month - 1, day)
  return (value.slice(0, 4) === today.slice(0, 4) ? shortDate : fullDate).format(date)
}
