import type { WindowCloseResponse } from '../../shared/api'

export function windowCloseDialogResponse(confirmed: boolean, doNotAskAgain: boolean): WindowCloseResponse {
  return confirmed ? { confirmed: true, doNotAskAgain } : { confirmed: false }
}

export function windowCloseDialogZoom(factor: number | undefined): number {
  return typeof factor === 'number' && Number.isFinite(factor) && factor >= 0.5 && factor <= 3 ? factor : 1
}
