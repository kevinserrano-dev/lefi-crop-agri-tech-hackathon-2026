import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  endpoints,
  queryKeys,
  type ActionResult,
  type DeviceDetail,
  type DeviceMode,
  type NewDevice,
} from '@lefi/api';
import { usePlatform } from '../../platform/PlatformContext';
import { describeError } from '../../shared/lib/errors';
import { useToast } from '../../shared/ui';

/** Device commands. The Brain validates and answers with a message, shown as is. */
export function useDeviceActions(deviceId: string | undefined) {
  const platform = usePlatform();
  const qc = useQueryClient();
  const toast = useToast((s) => s.show);
  const id = deviceId ?? '';

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: queryKeys.devices });
    void qc.invalidateQueries({ queryKey: queryKeys.navCounters });
    void qc.invalidateQueries({ queryKey: queryKeys.tasks });
  };
  const onSuccess = (r: ActionResult<DeviceDetail | null>) => {
    if (r.item) qc.setQueryData(queryKeys.device(r.item.id), r.item);
    refresh();
    toast(r.message, 'ok');
  };
  const onError = (e: unknown) => toast(describeError(e), 'bad');

  const setMode = useMutation({
    mutationFn: (mode: DeviceMode) => endpoints.setDeviceMode(platform, id, mode),
    onSuccess,
    onError,
  });
  const maintenance = useMutation({
    mutationFn: () => endpoints.scheduleMaintenance(platform, id),
    onSuccess,
    onError,
  });
  const approve = useMutation({
    mutationFn: () => endpoints.approveDevice(platform, id),
    onSuccess,
    onError,
  });
  const reject = useMutation({
    mutationFn: () => endpoints.rejectDevice(platform, id),
    onSuccess,
    onError,
  });
  const register = useMutation({
    mutationFn: (body: NewDevice) => endpoints.registerDevice(platform, body),
    onSuccess: (r) => {
      refresh();
      toast(r.message, 'ok');
    },
    onError,
  });

  const busy = setMode.isPending || maintenance.isPending || approve.isPending || reject.isPending;
  return { setMode, maintenance, approve, reject, register, busy };
}
