import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_symbols_icons/symbols.dart';

import '../../../app/router/routes.dart';
import '../../../core/theme/lefi_colors.dart';
import '../../../core/theme/lefi_text.dart';
import '../../../core/theme/tone.dart';
import '../../../core/widgets/async_view.dart';
import '../../../core/widgets/primitives.dart';
import '../../../core/widgets/rows.dart';
import '../../../core/widgets/scaffolds.dart';
import '../application/devices_providers.dart';
import '../domain/field_device.dart';

String _two(int v) => v.toString().padLeft(2, '0');

String seenAgo(DateTime? t, {DateTime? now}) {
  if (t == null) return 'never';
  final d = (now ?? DateTime.now()).difference(t);
  if (d.inSeconds < 60) return '${d.inSeconds.clamp(0, 59)} s ago';
  if (d.inMinutes < 60) return '${d.inMinutes} min ago';
  if (d.inHours < 24) return '${_two(t.hour)}:${_two(t.minute)}';
  return '${t.day}/${t.month} ${_two(t.hour)}:${_two(t.minute)}';
}

/// Connectivity (kept apart from data health, frontend rule).
(String, Tone) connectionOf(FieldDevice d) => switch (d.connection) {
  'online' => ('Online', Tone.ok),
  'offline' => ('Offline', Tone.crit),
  _ => ('Never connected', Tone.off),
};

/// What Lefi Brain can say about a sensor's data (ADR-059): LIVE · SIMULATED · STALE · ERROR · NO DATA.
(String, Tone) dataStateOf(FieldSensor s, {required bool simulated}) => switch (s.dataState) {
  'receiving' when simulated => ('SIMULATED', Tone.ai),
  'receiving' => ('LIVE', Tone.ok),
  'not_receiving' => ('STALE', Tone.warn),
  'error' => ('ERROR', Tone.crit),
  'disabled' => ('OFF', Tone.off),
  _ => ('NO DATA', Tone.off),
};

/// Profile → Devices & health: Lefi Brain's field devices, read-only.
class DevicesScreen extends ConsumerWidget {
  const DevicesScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final async = ref.watch(fieldDevicesProvider);
    return PushedScreen(
      title: 'Devices & health',
      backLabel: 'Profile',
      body: AsyncView(
        async,
        data: (devices) {
          final online = devices.where((d) => d.connection == 'online').length;
          final sensors = devices.fold<int>(0, (n, d) => n + d.sensorsEnabled);
          return ScrollBody(
            children: [
              LefiCard(
                child: Row(
                  children: [
                    const ToneChip('LIVE', tone: Tone.ok, fontSize: 10, radius: 5),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Text(
                        '$online of ${devices.length} online · $sensors sensors enabled · from Lefi Brain',
                        style: LefiText.body(12.5, color: LefiColors.muted, height: 1.4),
                      ),
                    ),
                  ],
                ),
              ),
              if (devices.isEmpty)
                Text(
                  'Lefi Brain has no field devices yet. They are added from Lefi Desktop.',
                  style: LefiText.body(14, color: LefiColors.subtle),
                )
              else
                CardList(
                  children: [
                    for (final d in devices)
                      NavRow(
                        icon: Symbols.memory_rounded,
                        tone: connectionOf(d).$2,
                        title: d.name,
                        subtitle: [
                          '${d.sensorsEnabled} of ${d.sensorsTotal} sensors',
                          'seen ${seenAgo(d.lastSeenAt)}',
                          if (d.rssiDbm != null) '${d.rssiDbm} dBm',
                          if (d.simulated) 'SIMULATED',
                          if (d.status == 'PENDING') 'pending approval',
                        ].join(' · '),
                        chip: connectionOf(d).$1,
                        chipTone: connectionOf(d).$2,
                        onTap: () => context.pushDetail<void>('${Routes.devices}/${Uri.encodeComponent(d.id)}'),
                      ),
                  ],
                ),
            ],
          );
        },
      ),
    );
  }
}

/// One device: connection, board health and every sensor with its latest values.
class DeviceScreen extends ConsumerWidget {
  const DeviceScreen({super.key, required this.deviceId});
  final String deviceId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final async = ref.watch(fieldDeviceProvider(deviceId));
    return PushedScreen(
      title: async.value?.name ?? 'Device',
      backLabel: 'Devices',
      body: AsyncView(
        async,
        data: (d) {
          final (conn, connTone) = connectionOf(d);
          final h = d.health;
          return ScrollBody(
            children: [
              Wrap(
                spacing: 6,
                runSpacing: 6,
                children: [
                  ToneChip(conn, tone: connTone),
                  ToneChip(d.status, tone: d.status == 'ACTIVE' ? Tone.ok : Tone.warn),
                  if (d.simulated) const ToneChip('SIMULATED', tone: Tone.ai),
                ],
              ),
              LefiCard(
                padding: const EdgeInsets.symmetric(horizontal: 14),
                child: Column(
                  children: [
                    KeyValueRow('Last seen', seenAgo(d.lastSeenAt)),
                    KeyValueRow('Type', d.profileId),
                    if (d.firmware != null) KeyValueRow('Firmware', d.firmware!),
                    if (d.network != null) KeyValueRow('Network', d.network!),
                    if (d.rssiDbm != null) KeyValueRow('Signal', '${d.rssiDbm} dBm'),
                    if (h['ip'] != null) KeyValueRow('IP', '${h['ip']}'),
                    if (d.mac != null) KeyValueRow('MAC', d.mac!),
                    KeyValueRow('Device id', d.id, last: h.isEmpty),
                    if (h['free_heap'] != null) KeyValueRow('Free memory', '${h['free_heap']} B'),
                    if (h['wifi_reconnects'] != null) KeyValueRow('Wi-Fi reconnects', '${h['wifi_reconnects']}'),
                    if (h['mqtt_reconnects'] != null) KeyValueRow('MQTT reconnects', '${h['mqtt_reconnects']}'),
                    if (h['reset_reason'] != null) KeyValueRow('Last reset', '${h['reset_reason']}', last: true),
                  ],
                ),
              ),
              const SectionTitle('Sensors', size: 16),
              if (d.sensors.isEmpty)
                Text('No sensors added to this device.', style: LefiText.body(14, color: LefiColors.subtle))
              else
                for (final s in d.sensors) _SensorCard(s, simulated: d.simulated),
              Text(
                'Read-only: devices and sensors are added and changed from Lefi Desktop.',
                style: LefiText.body(12, color: LefiColors.subtle),
              ),
            ],
          );
        },
      ),
    );
  }
}

class _SensorCard extends StatelessWidget {
  const _SensorCard(this.s, {required this.simulated});
  final FieldSensor s;
  final bool simulated;

  @override
  Widget build(BuildContext context) {
    final (state, tone) = dataStateOf(s, simulated: simulated);
    final live = s.dataState == 'receiving';
    return LefiCard(
      child: Gap(
        gap: 8,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  [s.label, ?s.model].join(' · '),
                  style: LefiText.body(14.5, weight: 700, color: LefiColors.ink),
                ),
              ),
              ToneChip(state, tone: tone, fontSize: 10.5),
            ],
          ),
          if (s.place != null) Text(s.place!, style: LefiText.body(12.5, color: LefiColors.muted)),
          if (s.values.isNotEmpty)
            Wrap(
              spacing: 18,
              runSpacing: 8,
              children: [
                for (final v in s.values)
                  Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        live ? v.shown : '—',
                        style: LefiText.outfit(20, color: live ? LefiColors.ink : LefiColors.subtle),
                      ),
                      Text(v.label, style: LefiText.body(11.5, color: LefiColors.subtle)),
                    ],
                  ),
              ],
            ),
          Text(switch (s.dataState) {
            'error' => 'Device reports: ${s.lastError ?? 'cannot read this sensor'}',
            'disabled' => 'Not enabled in Lefi Desktop',
            'waiting' => 'Enabled, nothing received yet',
            _ => 'Last value ${seenAgo(s.lastValueAt)}',
          }, style: LefiText.body(12, color: s.dataState == 'error' ? LefiColors.dangerDeep : LefiColors.subtle)),
        ],
      ),
    );
  }
}
