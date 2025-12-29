/**
 * Footer - Shared footer component for all pages
 */

export function Footer() {
  return (
    <footer className="mt-auto py-6 text-center text-slate-600 text-sm border-t border-slate-800/50">
      <div className="flex items-center justify-center gap-2 mb-2">
        <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse"></span>
        <span className="text-xs uppercase tracking-wider text-slate-500">
          Security Protocol Protected
        </span>
      </div>
      <p>© 2025 Depollute Now • All systems operational</p>
    </footer>
  );
}
