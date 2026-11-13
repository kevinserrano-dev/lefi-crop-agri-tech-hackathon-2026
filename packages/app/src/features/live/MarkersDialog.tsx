import { useQueries } from '@tanstack/react-query';
import { live } from '@lefi/api';
import { usePlatform } from '../../platform/PlatformContext';
import { describeError } from '../../shared/lib/errors';
import { Button, Dialog, Icon } from '../../shared/ui';
import styles from './live.module.css';

const toDataUrl = (svg: string) => `data:image/svg+xml;base64,${btoa(svg)}`;

/**
 * Printable zone markers (ADR-088): each zone's QR code from Lefi Brain, with its code and name in
 * large letters for people. The camera reads the QR code; people read the letters.
 */
export function MarkersDialog({
  open,
  zones,
  onClose,
}: {
  open: boolean;
  zones: { id: string; name: string; code?: string | null }[];
  onClose: () => void;
}) {
  const platform = usePlatform();
  const markers = useQueries({
    queries: zones.map((z) => ({
      queryKey: ['zone-marker', z.id],
      queryFn: () => live.zoneMarker(platform, z.id),
      enabled: open,
      staleTime: Infinity,
    })),
  });
  return (
    <Dialog open={open} onClose={onClose} labelledBy="markers-title" width={900}>
      <div className={styles.dialogHead}>
        <h2 id="markers-title">Zone markers</h2>
        <button type="button" aria-label="Close" onClick={onClose}>
          <Icon name="close" size={22} />
        </button>
      </div>
      <div className={styles.pad}>
        <p className={styles.muted}>
          Print at least 10 cm wide on matte paper. Place each one inside its zone, facing the
          camera, where the camera should look; keep it lit and flat.
        </p>
        <div className={styles.markerSheet} data-print-area>
          {zones.map((z, i) => {
            const m = markers[i];
            return (
              <figure key={z.id} className={styles.marker}>
                {m?.data ? (
                  <img src={toDataUrl(m.data.svg)} alt={`QR marker of ${z.name}`} />
                ) : (
                  <span className={styles.muted}>
                    {m?.isError ? describeError(m.error) : 'Loading…'}
                  </span>
                )}
                <figcaption>
                  {z.code && <span className={styles.markerCode}>{z.code}</span>}
                  <span className={styles.markerName}>{z.name}</span>
                  <span className={styles.mono}>LEFI CROP · zone marker</span>
                </figcaption>
              </figure>
            );
          })}
        </div>
      </div>
      <div className={styles.dialogFoot}>
        <Button type="button" variant="ghost" onClick={onClose}>
          Close
        </Button>
        <Button type="button" icon="print" onClick={() => window.print()}>
          Print
        </Button>
      </div>
    </Dialog>
  );
}
