import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { ActivityTooltip } from './ActivityTooltip'
import { WorkbenchElementGlyph } from './WorkbenchElementGlyph'
import type { WorkspaceDiffPreferences } from './workspaceDiffModel'

type DiffControlGlyph = 'wrap' | 'refresh' | 'collapse' | 'expand' | 'busy' | 'checkmark' | 'loadFullFiles' | 'richPreview' | 'wordDiffs' | 'hideWhitespace' | 'hideImports' | 'copyGitApply'
type GlyphPayload = { width: number; height: number; viewBox: string; body: string }

// Static source artwork; the 20px/24px authored canvases display at icon-xs (16px).
const DIFF_CONTROL_GLYPHS: Record<DiffControlGlyph, GlyphPayload> = {
  "wrap": {
    "width": 16,
    "height": 16,
    "viewBox": "0 0 16 16",
    "body": "<path d=\"M12.6665 2.14111C12.9565 2.14111 13.1919 2.37655 13.1919 2.6665V13.3335C13.1917 13.6233 12.9563 13.8579 12.6665 13.8579C12.3767 13.8579 12.1413 13.6233 12.1411 13.3335V2.6665C12.1411 2.37655 12.3766 2.14111 12.6665 2.14111Z\" fill=\"currentColor\"/> <path d=\"M7.1665 4.80811C8.10467 4.80811 8.90555 5.09138 9.47803 5.61182C10.0534 6.13492 10.3578 6.86284 10.3579 7.6665C10.3579 8.60869 10.0708 9.36291 9.45752 9.86475C8.93889 10.2891 8.25432 10.4769 7.49561 10.5171L7.1665 10.5249H4.43506L5.37158 11.4624C5.57632 11.6674 5.5763 11.9996 5.37158 12.2046C5.16663 12.4095 4.83444 12.4094 4.62939 12.2046L2.92529 10.5015C2.64875 10.2249 2.64891 9.77615 2.92529 9.49951L4.62939 7.79541C4.8344 7.59085 5.16668 7.59068 5.37158 7.79541C5.57627 8.00032 5.57613 8.33261 5.37158 8.5376L4.43506 9.4751H7.1665L7.44678 9.46826C8.07224 9.43437 8.50902 9.28417 8.79248 9.05225C9.09578 8.80408 9.30811 8.39088 9.30811 7.6665C9.30803 7.13714 9.11307 6.69828 8.77197 6.38818C8.42778 6.07532 7.89496 5.85889 7.1665 5.85889H3.1665C2.87655 5.85889 2.64111 5.62345 2.64111 5.3335C2.64111 5.04355 2.87655 4.80811 3.1665 4.80811H7.1665Z\" fill=\"currentColor\"/>"
  },
  "refresh": {
    "width": 20,
    "height": 20,
    "viewBox": "0 0 20 20",
    "body": "<path d=\"M3.50205 16.6664V13.3333C3.50205 12.9661 3.79982 12.6683 4.16709 12.6683H7.5001L7.63389 12.682C7.93696 12.7439 8.16514 13.0119 8.16514 13.3333C8.16514 13.6547 7.93696 13.9227 7.63389 13.9847L7.5001 13.9984H5.47471C6.58687 15.2249 8.21848 16.0013 10.0001 16.0013C13.06 16.0013 15.586 13.711 15.9552 10.7513L15.9854 10.6195C16.0846 10.3266 16.3786 10.1335 16.6974 10.1732C17.0617 10.2186 17.3198 10.551 17.2745 10.9154L17.2247 11.2523C16.6301 14.7051 13.6225 17.3313 10.0001 17.3314C8.01108 17.3314 6.17193 16.5383 4.83213 15.2474V16.6664C4.83213 17.0335 4.53416 17.3312 4.16709 17.3314C3.79982 17.3314 3.50205 17.0336 3.50205 16.6664ZM4.04502 9.24936C3.99941 9.61354 3.66706 9.87179 3.30283 9.82651C2.93839 9.78106 2.67926 9.44877 2.72471 9.08432L4.04502 9.24936ZM10.0001 2.6683C11.994 2.66834 13.8372 3.46552 15.1778 4.76205V3.33334C15.1778 2.96617 15.4757 2.66846 15.8429 2.6683C16.2101 2.6683 16.5079 2.96607 16.5079 3.33334V6.66635C16.5079 7.03362 16.2101 7.33139 15.8429 7.33139H12.5099C12.1426 7.33139 11.8448 7.03362 11.8448 6.66635C11.845 6.29923 12.1427 6.00131 12.5099 6.00131H14.5255C13.4134 4.77489 11.7816 3.99842 10.0001 3.99838C6.94004 3.99838 4.41411 6.28948 4.04502 9.24936L3.38486 9.16635L2.72471 9.08432C3.1758 5.46703 6.26081 2.6683 10.0001 2.6683Z\" fill=\"currentColor\"/>"
  },
  "collapse": {
    "width": 24,
    "height": 24,
    "viewBox": "0 0 24 24",
    "body": "<path d=\"M13 9.50004L20 9.5\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\"/><path d=\"M13 14.5L17 14.5\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\"/><path d=\"M6.23999 4V9\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><path d=\"M6.23999 15V20\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><path d=\"M3.74009 16.5L6.24009 14L8.74009 16.5\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><path d=\"M8.74009 7.5L6.24009 10L3.74009 7.5\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/>"
  },
  "expand": {
    "width": 24,
    "height": 24,
    "viewBox": "0 0 24 24",
    "body": "<path d=\"M12.8 8L19.8 8\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\"/><path d=\"M12.8 12L19.8 12.002\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\"/><path d=\"M12.8 16L16.8 16\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\"/><path d=\"M6.24013 6V18\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><path d=\"M3.74022 7.50012L6.24022 5.00012L8.74022 7.50012\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><path d=\"M8.74022 16.5L6.24022 19L3.74022 16.5\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/>"
  },
  "busy": {
    "width": 24,
    "height": 24,
    "viewBox": "0 0 24 24",
    "body": "<path opacity=\"0.3\" d=\"M18 12C18 8.68629 15.3137 6 12 6C8.68629 6 6 8.68629 6 12C6 15.3137 8.68629 18 12 18C15.3137 18 18 15.3137 18 12ZM20 12C20 16.4183 16.4183 20 12 20C7.58172 20 4 16.4183 4 12C4 7.58172 7.58172 4 12 4C16.4183 4 20 7.58172 20 12Z\" fill=\"currentColor\"/><path d=\"M12 4C16.4183 4 20 7.58172 20 12C20 16.4183 16.4183 20 12 20C7.58172 20 4 16.4183 4 12H6C6 15.3137 8.68629 18 12 18C15.3137 18 18 15.3137 18 12C18 8.68629 15.3137 6 12 6V4Z\" fill=\"currentColor\"/>"
  },
  "checkmark": {
    "width": 17,
    "height": 17,
    "viewBox": "0 0 17 17",
    "body": "<path d=\"M12.8961 3.64101C13.1297 3.41418 13.4984 3.37523 13.7779 3.56581C14.0571 3.75635 14.1554 4.11331 14.0299 4.41347L13.9615 4.53847L7.71151 13.7045C7.59411 13.8767 7.4063 13.9877 7.19881 14.0072C6.99136 14.0267 6.78564 13.9533 6.63826 13.806L2.88826 10.056L2.79842 9.9457C2.6192 9.67407 2.64927 9.30496 2.88826 9.06581C3.12738 8.82669 3.49647 8.79676 3.76815 8.97597L3.8785 9.06581L7.03084 12.2182L12.8053 3.74941L12.8961 3.64101Z\" fill=\"currentColor\"/>"
  },
  "loadFullFiles": {
    "width": 16,
    "height": 16,
    "viewBox": "0 0 16 16",
    "body": "<path d=\"M9.50488 1.80786C10.1745 1.80786 10.8165 2.07457 11.29 2.5481L12.7852 4.04321C13.2587 4.51674 13.5254 5.1587 13.5254 5.82837V11.6663C13.5254 13.0608 12.3945 14.1917 11 14.1917H5C3.60548 14.1917 2.47461 13.0608 2.47461 11.6663V4.33325C2.47461 2.93873 3.60548 1.80786 5 1.80786H9.50488ZM5 2.85864C4.18538 2.85864 3.52539 3.51863 3.52539 4.33325V11.6663C3.52539 12.4809 4.18538 13.1418 5 13.1418H11C11.8146 13.1418 12.4746 12.4809 12.4746 11.6663V6.85864H10.666C9.64 6.8584 8.80779 6.02627 8.80762 5.00024V2.85864H5ZM9.8584 5.00024C9.85857 5.44637 10.2199 5.80762 10.666 5.80786H12.4736C12.4683 5.42409 12.3147 5.05718 12.043 4.7854L10.5479 3.29028C10.3563 3.09869 10.1171 2.96641 9.8584 2.90259V5.00024Z\" fill-rule=\"evenodd\" clip-rule=\"evenodd\" fill=\"currentColor\"/>"
  },
  "richPreview": {
    "width": 16,
    "height": 16,
    "viewBox": "0 0 16 16",
    "body": "<path d=\"M10.0811 4.49951C11.1994 4.49951 12.1064 5.40653 12.1064 6.5249C12.1062 7.64305 11.1993 8.55029 10.0811 8.55029C8.96284 8.55029 8.05593 7.64305 8.05566 6.5249C8.05566 5.40653 8.96268 4.49951 10.0811 4.49951ZM10.0811 5.55029C9.54258 5.55029 9.10645 5.98642 9.10645 6.5249C9.10671 7.06316 9.54274 7.49951 10.0811 7.49951C10.6194 7.49951 11.0554 7.06316 11.0557 6.5249C11.0557 5.98642 10.6195 5.55029 10.0811 5.55029Z\" fill-rule=\"evenodd\" clip-rule=\"evenodd\" fill=\"currentColor\"/> <path d=\"M11.8662 2.14111C13.3344 2.14111 14.5254 3.33214 14.5254 4.80029V11.1997C14.5254 12.6679 13.3344 13.8579 11.8662 13.8579H4.13379C2.66563 13.8579 1.47461 12.6679 1.47461 11.1997V4.80029C1.47461 3.33214 2.66563 2.14111 4.13379 2.14111H11.8662ZM4.13379 3.19189C3.24553 3.19189 2.52539 3.91203 2.52539 4.80029V9.58545L3.55371 8.55811C4.34438 7.76761 5.62617 7.76675 6.41699 8.55713L10.6699 12.8081H11.8662C12.7545 12.8081 13.4746 12.088 13.4746 11.1997V4.80029C13.4746 3.91204 12.7545 3.19189 11.8662 3.19189H4.13379ZM5.6748 9.30029C5.29407 8.91977 4.6766 8.91977 4.2959 9.30029L2.52539 11.0708V11.1997C2.52539 12.088 3.24553 12.8081 4.13379 12.8081H9.18457L5.6748 9.30029Z\" fill-rule=\"evenodd\" clip-rule=\"evenodd\" fill=\"currentColor\"/>"
  },
  "wordDiffs": {
    "width": 16,
    "height": 16,
    "viewBox": "0 0 16 16",
    "body": "<path d=\"M9.6665 10.1421C9.95628 10.1423 10.1919 10.3777 10.1919 10.6675C10.1916 10.9571 9.95612 11.1927 9.6665 11.1929H6.3335C6.04371 11.1929 5.80837 10.9572 5.80811 10.6675C5.80811 10.3775 6.04355 10.1421 6.3335 10.1421H9.6665Z\" fill=\"currentColor\"/> <path d=\"M7.99951 4.4751C8.28946 4.4751 8.5249 4.71054 8.5249 5.00049V6.14209H9.6665C9.95628 6.14229 10.1919 6.37765 10.1919 6.66748C10.1916 6.95708 9.95612 7.19267 9.6665 7.19287H8.5249V8.3335C8.52464 8.62322 8.2893 8.85889 7.99951 8.85889C7.70989 8.85869 7.47438 8.6231 7.47412 8.3335V7.19287H6.3335C6.04371 7.19287 5.80837 6.95721 5.80811 6.66748C5.80811 6.37753 6.04355 6.14209 6.3335 6.14209H7.47412V5.00049C7.47412 4.71066 7.70973 4.4753 7.99951 4.4751Z\" fill=\"currentColor\"/> <path d=\"M11.4663 2.14111C12.787 2.14111 13.8577 3.21204 13.8579 4.53271V11.4663C13.8579 12.7872 12.7872 13.8579 11.4663 13.8579H4.53271C3.21204 13.8577 2.14111 12.787 2.14111 11.4663V4.53271C2.14136 3.2122 3.2122 2.14136 4.53271 2.14111H11.4663ZM4.53271 3.19189C3.79209 3.19214 3.19214 3.79209 3.19189 4.53271V11.4663C3.19189 12.2071 3.79194 12.8079 4.53271 12.8081H11.4663C12.2073 12.8081 12.8081 12.2073 12.8081 11.4663V4.53271C12.8079 3.79194 12.2071 3.19189 11.4663 3.19189H4.53271Z\" fill-rule=\"evenodd\" clip-rule=\"evenodd\" fill=\"currentColor\"/>"
  },
  "hideWhitespace": {
    "width": 16,
    "height": 16,
    "viewBox": "0 0 16 16",
    "body": "<path d=\"M8.16885 4.80859C9.93137 4.80882 11.3603 6.23841 11.3603 8.00098C11.36 9.76328 9.93118 11.1922 8.16885 11.1924C6.40633 11.1924 4.97678 9.76342 4.97647 8.00098C4.97647 6.23827 6.40615 4.80859 8.16885 4.80859ZM8.16885 5.85938C6.98604 5.85938 6.02725 6.81817 6.02725 8.00098C6.02756 9.18352 6.98623 10.1426 8.16885 10.1426C9.35128 10.1424 10.3101 9.18339 10.3105 8.00098C10.3105 6.81831 9.35147 5.8596 8.16885 5.85938Z\" fill-rule=\"evenodd\" clip-rule=\"evenodd\" fill=\"currentColor\"/> <path d=\"M8.16885 2.14258C11.3719 2.14283 13.9035 4.76035 15.1044 7.00391L15.1054 7.00293C15.4432 7.6258 15.4431 8.37514 15.1054 8.99805C13.9044 11.2416 11.3719 13.8591 8.16885 13.8594C4.96574 13.8593 2.43333 11.2416 1.23233 8.99805L1.17276 8.87988C0.895711 8.28202 0.915602 7.5869 1.23233 7.00293L1.23331 7.00391C2.43428 4.76029 4.9657 2.14266 8.16885 2.14258ZM8.16885 3.19238C5.53817 3.19246 3.28385 5.39481 2.15713 7.50098L2.15518 7.50391C1.98681 7.81461 1.98666 8.1874 2.15518 8.49805L2.15713 8.5C3.28385 10.6062 5.53817 12.8085 8.16885 12.8086C10.7995 12.8083 13.0539 10.6061 14.1806 8.5L14.1825 8.49805C14.3509 8.18746 14.3508 7.81453 14.1825 7.50391L14.1806 7.50098C13.0539 5.39486 10.7995 3.19264 8.16885 3.19238Z\" fill-rule=\"evenodd\" clip-rule=\"evenodd\" fill=\"currentColor\"/>"
  },
  "hideImports": {
    "width": 16,
    "height": 16,
    "viewBox": "0 0 16 16",
    "body": "<path d=\"M13.2271 10.5539C13.2271 10.8409 13.0742 11.1066 12.8257 11.2502L8.5249 13.7336V8.30679L13.2271 5.66226V10.5539ZM3.08936 4.80777C3.1164 4.78715 3.14441 4.76742 3.17432 4.75015L7.59814 2.19644C7.84673 2.05292 8.15327 2.05292 8.40186 2.19644L12.7671 4.71695L7.9917 7.4025L3.08936 4.80777ZM2.77295 5.8273L7.4751 8.31656V13.7336L3.17432 11.2502C2.92573 11.1066 2.77295 10.8409 2.77295 10.5539V5.8273ZM14.2769 5.44547C14.2767 4.78347 13.9234 4.17198 13.3501 3.84097L8.92627 1.28629C8.35289 0.955427 7.64608 0.955278 7.07275 1.28629L2.64893 3.84097C2.0758 4.17203 1.72233 4.7836 1.72217 5.44547V10.5539C1.72217 11.2159 2.07561 11.8282 2.64893 12.1593L7.07275 14.713C7.64618 15.0441 8.35283 15.0441 8.92627 14.713L13.3501 12.1593C13.9236 11.8282 14.2769 11.216 14.2769 10.5539V5.44547Z\" fill=\"currentColor\"/>"
  },
  "copyGitApply": {
    "width": 16,
    "height": 16,
    "viewBox": "0 0 16 16",
    "body": "<path d=\"M9.90481 1.64111C10.0205 1.6506 10.1587 1.6735 10.2984 1.74463C10.4432 1.81842 10.568 1.9249 10.6626 2.05518L10.7466 2.19189L10.7915 2.29639C10.8284 2.39979 10.843 2.49952 10.8501 2.58643C10.854 2.63445 10.8521 2.68647 10.8531 2.74072C11.0373 2.75429 11.1998 2.77558 11.3511 2.81689C12.2809 3.07095 13.0081 3.79729 13.2622 4.72705C13.3633 5.09683 13.3579 5.53248 13.3579 6.19287V10.3921C13.3579 10.9995 13.3588 11.4872 13.3267 11.8804C13.294 12.2795 13.2249 12.6282 13.0611 12.9497C12.7998 13.4622 12.3832 13.8789 11.8706 14.1401C11.5491 14.304 11.2005 14.3731 10.8013 14.4058C10.4081 14.4379 9.9204 14.437 9.31302 14.437H6.68606C6.0789 14.437 5.59184 14.4379 5.19876 14.4058C4.79947 14.3731 4.45105 14.304 4.12942 14.1401C3.61686 13.879 3.20025 13.4622 2.93899 12.9497C2.77517 12.6282 2.70601 12.2795 2.67337 11.8804C2.64125 11.4872 2.64114 10.9995 2.64114 10.3921V6.19287C2.64114 5.53242 2.63676 5.09687 2.73782 4.72705C2.99194 3.79741 3.71834 3.07102 4.64798 2.81689C4.79929 2.77555 4.96181 2.75429 5.14602 2.74072C5.14723 2.68647 5.14601 2.63445 5.14993 2.58643C5.1594 2.47061 5.18223 2.33167 5.25345 2.19189C5.35165 1.99939 5.50821 1.84284 5.70071 1.74463C5.84048 1.67341 5.97943 1.65058 6.09524 1.64111C6.2049 1.63215 6.33505 1.63232 6.46634 1.63232H9.53274C9.66409 1.63232 9.7951 1.63215 9.90481 1.64111ZM10.8501 3.9917C10.8407 4.10752 10.8178 4.24645 10.7466 4.38623C10.6483 4.57895 10.4911 4.73528 10.2984 4.8335C10.1587 4.90463 10.0205 4.92753 9.90481 4.93701C9.7951 4.94598 9.66409 4.9458 9.53274 4.9458H6.46634C6.33505 4.9458 6.2049 4.94597 6.09524 4.93701C5.97943 4.92754 5.84048 4.90471 5.70071 4.8335C5.50821 4.73529 5.35165 4.57873 5.25345 4.38623C5.18223 4.24646 5.1594 4.10752 5.14993 3.9917C5.14493 3.93056 5.14598 3.86301 5.14505 3.79248C5.0573 3.80109 4.98826 3.81242 4.92532 3.82959C4.3538 3.98578 3.9067 4.43287 3.75052 5.00439C3.69605 5.20401 3.69192 5.46395 3.69192 6.19287V10.3921C3.69192 11.0168 3.69242 11.4539 3.72024 11.7944C3.74756 12.1288 3.79865 12.3242 3.87454 12.4731C4.03512 12.788 4.29107 13.0441 4.60598 13.2046C4.75494 13.2805 4.95033 13.3316 5.2847 13.3589C5.62507 13.3867 6.06182 13.3872 6.68606 13.3872H9.31302C9.93766 13.3872 10.3749 13.3867 10.7154 13.3589C11.0497 13.3316 11.2451 13.2805 11.3941 13.2046C11.7089 13.0441 11.965 12.788 12.1255 12.4731C12.2014 12.3242 12.2525 12.1288 12.2798 11.7944C12.3076 11.4539 12.3081 11.0168 12.3081 10.3921V6.19287C12.3081 5.46374 12.3031 5.20402 12.2486 5.00439C12.0924 4.43284 11.6463 3.98576 11.0747 3.82959C11.0115 3.81233 10.9422 3.8011 10.854 3.79248C10.8534 3.86301 10.8551 3.93056 10.8501 3.9917ZM6.19583 2.68701C6.19219 2.74305 6.19192 2.82148 6.19192 2.95752V3.62061C6.19192 3.75586 6.19225 3.83416 6.19583 3.89014C6.25187 3.89378 6.33025 3.89502 6.46634 3.89502H9.53274C9.66843 3.89502 9.74723 3.89374 9.80325 3.89014C9.80683 3.83416 9.80813 3.75589 9.80813 3.62061V2.95752C9.80813 2.82145 9.80689 2.74305 9.80325 2.68701C9.74723 2.68341 9.66837 2.68311 9.53274 2.68311H6.46634C6.3303 2.68311 6.25187 2.68338 6.19583 2.68701Z\" fill-rule=\"evenodd\" clip-rule=\"evenodd\" fill=\"currentColor\"/>"
  }
}

export function WorkspaceDiffControlIcon({ name }: { name: DiffControlGlyph }): ReactNode {
  const glyph = DIFF_CONTROL_GLYPHS[name]
  return <svg width={16} height={16} viewBox={glyph.viewBox} fill="none" stroke="none" aria-hidden="true" focusable="false"
    className={name === 'busy' ? 'workspace-diff-control-busy' : undefined} data-workspace-diff-control-glyph={name}
    dangerouslySetInnerHTML={{ __html: glyph.body }} />
}

interface WorkspaceDiffOptionsProps {
  preferences: WorkspaceDiffPreferences
  onChange(preferences: WorkspaceDiffPreferences): void
  onClose(): void
  showLoadFullFiles?: boolean
  showRichPreview?: boolean
  showHideWhitespace?: boolean
  showHideImports?: boolean
  showCopyGitApplyCommand?: boolean
  copyGitApplyCommandDisabled?: boolean
  onClickCopyGitApplyCommand?(): void
}

/** Installed Ue: five close-on-select checkboxes, then the conditionally disabled copy action. */
export function WorkspaceDiffOptions({ preferences, onChange, onClose, showLoadFullFiles = true,
  showRichPreview = true, showHideWhitespace = true, showHideImports = true, showCopyGitApplyCommand,
  copyGitApplyCommandDisabled, onClickCopyGitApplyCommand }: WorkspaceDiffOptionsProps): ReactNode {
  const checkbox = (key: 'loadFullFiles' | 'richPreview' | 'wordDiffs' | 'hideWhitespace' | 'hideImports', label: string): ReactNode =>
    <button type="button" role="menuitemcheckbox" aria-checked={preferences[key]} onClick={() => {
      onChange({ ...preferences, [key]: !preferences[key] }); onClose()
    }}><WorkspaceDiffControlIcon name={key} /><span>{label}</span>
      <span className="workspace-diff-menu-check" aria-hidden="true">{preferences[key] && <WorkspaceDiffControlIcon name="checkmark" />}</span>
    </button>
  return <>
    {showLoadFullFiles && checkbox('loadFullFiles', '加载完整文件')}
    {showRichPreview && checkbox('richPreview', '渲染预览')}
    {checkbox('wordDiffs', '词级差异')}
    {showHideWhitespace && checkbox('hideWhitespace', '隐藏空白字符')}
    {showHideImports && checkbox('hideImports', '隐藏导入内容')}
    {showCopyGitApplyCommand && <button type="button" role="menuitem"
      disabled={copyGitApplyCommandDisabled || !onClickCopyGitApplyCommand}
      onClick={(event) => { event.preventDefault(); onClickCopyGitApplyCommand?.(); onClose() }}>
      <WorkspaceDiffControlIcon name="copyGitApply" /><span>复制 git apply 命令</span>
    </button>}
  </>
}

interface DiffControlsProps {
  wrap: boolean
  onToggleWrap(): void
  expanded: boolean
  onToggleExpanded(): void
  styleLabel: string
  styleIcon: ReactNode
  onCycleStyle(): void
  onRefresh?(): void
  showRefreshGitQueries: boolean
  refreshGitQueriesDisabled: boolean
  refreshing: boolean
  toolbarTarget?: HTMLElement | null
  trailingMenu(onClose: () => void): ReactNode
}

/** Re moves its four existing controls into Changes options below 625 CSS px. */
export function useWorkspaceDiffControls(props: DiffControlsProps): { leadingControls: ReactNode; fileControls: ReactNode } {
  const { wrap, onToggleWrap, expanded, onToggleExpanded, styleLabel, styleIcon, onCycleStyle,
    onRefresh, showRefreshGitQueries, refreshGitQueriesDisabled, refreshing, toolbarTarget, trailingMenu } = props
  const options = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const inline = useRef<HTMLDivElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const [narrow, setNarrow] = useState(false)
  const [open, setOpen] = useState(false)
  const narrowRef = useRef(false)
  const restoreFocus = useRef(false)
  const firstFocus = useRef<'first' | 'last'>('first')
  const id = useId()
  const collapseLabel = expanded ? '折叠全部差异' : '展开全部差异'
  const refreshDisabled = refreshGitQueriesDisabled || !onRefresh

  useLayoutEffect(() => {
    const header = options.current?.closest('header')
    if (!header) return
    const resize = (): void => {
      const next = header.clientWidth < 625
      if (next === narrowRef.current) return
      restoreFocus.current = Boolean(inline.current?.contains(document.activeElement) || menu.current?.contains(document.activeElement))
      narrowRef.current = next
      setNarrow(next)
      setOpen(false)
    }
    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(header)
    return () => observer.disconnect()
  }, [toolbarTarget])
  useLayoutEffect(() => {
    if (!restoreFocus.current) return
    restoreFocus.current = false
    trigger.current?.focus()
  }, [narrow])
  useLayoutEffect(() => {
    if (!open) return
    const buttons = menu.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')
    const target = firstFocus.current === 'last' ? buttons?.[buttons.length - 1] : buttons?.[0]
    target?.focus()
  }, [open])
  useEffect(() => {
    if (!open) return
    const outside = (event: PointerEvent): void => {
      if (event.target instanceof Node && options.current?.contains(event.target)) return
      setOpen(false)
    }
    const escape = (event: globalThis.KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      event.preventDefault()
      setOpen(false)
      trigger.current?.focus()
    }
    const blur = (): void => setOpen(false)
    window.addEventListener('pointerdown', outside)
    window.addEventListener('keydown', escape)
    window.addEventListener('blur', blur)
    return () => {
      window.removeEventListener('pointerdown', outside)
      window.removeEventListener('keydown', escape)
      window.removeEventListener('blur', blur)
    }
  }, [open])
  const close = (): void => { setOpen(false); trigger.current?.focus() }
  const select = (action: () => void): void => { action(); close() }
  const openFromKey = (event: KeyboardEvent<HTMLButtonElement>): void => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    event.preventDefault()
    firstFocus.current = event.key === 'ArrowUp' ? 'last' : 'first'
    if (open) {
      const buttons = menu.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')
      ;(firstFocus.current === 'last' ? buttons?.[buttons.length - 1] : buttons?.[0])?.focus()
    } else setOpen(true)
  }
  const navigateMenu = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); return }
    if (event.key === 'Tab') { setOpen(false); return }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    const buttons = Array.from(menu.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])
    if (!buttons.length) return
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
      : event.key === 'ArrowDown' ? (index + 1) % buttons.length : (index - 1 + buttons.length) % buttons.length
    buttons[next]?.focus()
  }
  const check = <span className="workspace-diff-menu-check" aria-hidden="true">{wrap && <WorkspaceDiffControlIcon name="checkmark" />}</span>
  const leadingControls = <div ref={options} className="workspace-diff-options-control">
    <ActivityTooltip variant="copy" openDelay={250} content={open ? undefined : '“变更”选项'}>
      <button ref={trigger} type="button" aria-label="“变更”选项" aria-haspopup="menu" aria-busy={refreshing}
        aria-expanded={open} aria-controls={open ? id : undefined} onKeyDown={openFromKey}
        onClick={() => { firstFocus.current = 'first'; setOpen((value) => !value) }}>
        {narrow && refreshing ? <WorkspaceDiffControlIcon name="busy" /> : <WorkbenchElementGlyph name="ellipsis-horizontal-light-16" size={16} />}
      </button>
    </ActivityTooltip>
    <div ref={menu} id={id} className="workspace-diff-options-menu" role="menu" hidden={!open} aria-label="“变更”选项" onKeyDown={navigateMenu}>
      {narrow && <>
        {showRefreshGitQueries && <button type="button" role="menuitem" disabled={refreshDisabled}
          onClick={() => select(() => onRefresh?.())}><WorkspaceDiffControlIcon name="refresh" /><span>刷新</span></button>}
        <button type="button" role="menuitemcheckbox" aria-checked={wrap} onClick={() => select(onToggleWrap)}>
          <WorkspaceDiffControlIcon name="wrap" /><span>自动换行</span>{check}</button>
        <button type="button" role="menuitem" onClick={() => select(onCycleStyle)}>{styleIcon}<span>{styleLabel}</span></button>
        <button type="button" role="menuitem" onClick={() => select(onToggleExpanded)}>
          <WorkspaceDiffControlIcon name={expanded ? 'collapse' : 'expand'} /><span>{collapseLabel}</span></button>
        <div role="separator" className="workspace-diff-menu-separator" />
      </>}
      {trailingMenu(close)}
    </div>
  </div>
  const fileControls = <div ref={inline} className="workspace-diff-controls workspace-diff-file-controls" hidden={narrow}>
    {showRefreshGitQueries && <ActivityTooltip variant="copy" content="刷新"><button type="button" aria-label="刷新" aria-busy={refreshing}
      disabled={refreshDisabled} onClick={onRefresh}><WorkspaceDiffControlIcon name={refreshing ? 'busy' : 'refresh'} /></button></ActivityTooltip>}
    <ActivityTooltip variant="copy" content="自动换行"><button type="button" aria-label="自动换行" aria-pressed={wrap}
      onClick={onToggleWrap}><WorkspaceDiffControlIcon name="wrap" /></button></ActivityTooltip>
    <ActivityTooltip variant="copy" content={collapseLabel}><button type="button" aria-label={collapseLabel}
      onClick={onToggleExpanded}><WorkspaceDiffControlIcon name={expanded ? 'collapse' : 'expand'} /></button></ActivityTooltip>
    <ActivityTooltip variant="copy" content={styleLabel}><button type="button" aria-label={styleLabel}
      onClick={onCycleStyle}>{styleIcon}</button></ActivityTooltip>
  </div>
  return { leadingControls, fileControls }
}
