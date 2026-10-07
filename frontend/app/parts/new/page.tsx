import {Suspense} from 'react';
import ListingEditor from '../../../components/parts/listing-editor';

export const metadata = {title: '판매글 등록'};

export default function Page() {
  return (
    <Suspense>
      <ListingEditor />
    </Suspense>
  );
}
