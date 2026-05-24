import Link from 'next/link';
import { Gem } from 'lucide-react';

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
            <div className="text-lg font-black text-slate-900">局面エディタ</div>
          </div>
        </Link>
      </div>
    </header>
  );
}
