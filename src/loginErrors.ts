export function withRetryWindow(message: string, language: 'ar' | 'en', seconds: number): string {
  return language === 'ar'
    ? `${message} أعد المحاولة بعد ${seconds} ثانية.`
    : `${message} Try again in ${seconds} seconds.`;
}
