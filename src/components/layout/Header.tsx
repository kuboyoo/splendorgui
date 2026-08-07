import Link from 'next/link';
import { Bot, Gem, SlidersHorizontal } from 'lucide-react';

export default function Header() {
  return (
    <header className="sticky top-0 z-50 border-b border-white/10 bg-white/80 backdrop-blur-xl shadow-xl shadow-black/10">
      <div className="mx-auto flex max-w-[1400px] items-center justify-between gap-4 px-6 py-3">
        <Link href="/" className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-900 text-white shadow-sm ring-1 ring-white/10">
            <Gem size={20} />
          </div>
          <div>
            <div className="text-xs font-black uppercase tracking-[0.22em] text-slate-400">lisplendor</div>
            <div className="text-lg font-black text-slate-900">Splendor GUI</div>
          </div>
        </Link>
        <nav className="flex items-center gap-2 text-sm font-bold">
          <Link
            href="/"
            className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white/50 px-3 py-2 text-slate-700 transition-colors hover:bg-slate-100"
          >
            <SlidersHorizontal size={15} />
            <span className="hidden sm:inline">局面エディタ</span>
          </Link>
          <Link
            href="/play"
            className="flex items-center gap-2 rounded-xl bg-emerald-500 px-3 py-2 text-emerald-950 transition-colors hover:bg-emerald-400"
          >
            <Bot size={15} />
            <span>AI対局</span>
          </Link>
        </nav>
      </div>
    </header>
  );
}
