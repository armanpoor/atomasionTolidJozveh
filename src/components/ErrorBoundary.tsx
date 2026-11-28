import React from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    let message = error?.message || 'خطای غیرمنتظره‌ای در رابط کاربری رخ داد.';
    try {
      const parsed = JSON.parse(message) as { error?: string; operationType?: string };
      if (parsed?.error) {
        message = `خطای دسترسی یا همگام‌سازی داده‌ها (${parsed.operationType || 'read'}): ${parsed.error}`;
      }
    } catch {
      // Plain error string
    }
    return { hasError: true, message };
  }

  componentDidCatch(error: Error) {
    console.error('ErrorBoundary caught:', error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          dir="rtl"
          role="alert"
          className="min-h-screen bg-[#FAF9F6] flex items-center justify-center p-6"
        >
          <div className="max-w-lg w-full bg-white border border-[#E5E2DC] rounded-xl p-6 shadow-sm space-y-4">
            <div className="flex items-center gap-3 text-[#9A3412]">
              <AlertTriangle className="w-6 h-6 shrink-0" />
              <h2 className="text-base font-bold text-[#1A1816]">
                خطا در بارگذاری محیط کاری
              </h2>
            </div>
            <p className="text-sm text-[#57534E] leading-7 break-words">
              {this.state.message}
            </p>
            <div className="flex flex-wrap items-center gap-2.5">
              <button
                type="button"
                onClick={() => {
                  this.setState({ hasError: false, message: '' });
                }}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-[#1E3A5F] text-white text-sm font-medium hover:bg-[#162C49] transition-colors cursor-pointer"
              >
                <RotateCcw className="w-4 h-4" />
                تلاش مجدد بدون رفرش
              </button>
              <button
                type="button"
                onClick={() => {
                  this.setState({ hasError: false, message: '' });
                  window.location.reload();
                }}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg border border-[#D8D2C5] bg-white text-[#1A1816] text-sm font-medium hover:bg-[#F5F2EB] transition-colors cursor-pointer"
              >
                بارگذاری مجدد کامل صفحه
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
