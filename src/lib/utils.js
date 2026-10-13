import { clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export const isIframe = window.self !== window.top;

export function cn(...inputs) {
  return twMerge(clsx(inputs))
}
