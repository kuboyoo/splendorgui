import { notFound } from 'next/navigation';
import PositionEditorClient from '@/components/position-editor/PositionEditorClient';
import { getSavedPosition } from '@/lib/server/firestorePositions';

export const dynamic = 'force-dynamic';

export default async function SharedPositionPage(
  props: { params: Promise<{ id: string }> },
) {
  const { id } = await props.params;
  const entry = await getSavedPosition(id);

  if (!entry) {
    notFound();
  }

  return <PositionEditorClient initialSavedPosition={entry} />;
}
