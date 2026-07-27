import type { Metadata } from 'next';
import PlayClient from '@/components/play/PlayClient';

export const metadata: Metadata = {
  title: 'AI対局・観戦 | lisplendor',
  description: 'dlsplendorの学習済みモデルとの対局やAI同士の対局観戦ができます。',
};

export default function PlayPage() {
  return <PlayClient />;
}
