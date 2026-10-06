import {Suspense} from 'react';
import ListingEditor from '../../../components/parts/listing-editor';

export const metadata = {title: '판매글 등록 | REV.CC'};

export default function Page() {
  return (
    <Suspense>
      <ListingEditor />
    </Suspense>
  );
}
