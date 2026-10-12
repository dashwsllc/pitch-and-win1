export function callDurationMinutes(call:{duration_minutes?:number}):number{return call.duration_minutes??30}
export function callEndIso(call:{scheduled_at:string|null;duration_minutes?:number}):string|null {
  const start=Date.parse(call.scheduled_at??''), minutes=callDurationMinutes(call)
  return Number.isFinite(start)&&Number.isInteger(minutes)&&minutes>=1&&minutes<=480?new Date(start+minutes*60000).toISOString():null
}
