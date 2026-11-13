// Lefi Crop mobile against a REAL Lefi Brain behind a REAL Lefi Gateway (Caddy, HTTPS, mTLS).
// Skipped unless `scripts/tests/desktop_gateway_real.sh` started both in a temporary folder and
// set LEFI_TEST_* (ADR-068). Never points at an installed Brain.
import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:lefi_mobile/features/ai_control/data/brain_ai_control_repository.dart';
import 'package:lefi_mobile/features/assistant/data/brain_chat_repository.dart';
import 'package:lefi_mobile/features/assistant/domain/brain_chat.dart';
import 'package:lefi_mobile/features/auth/domain/auth_repository.dart';
import 'package:lefi_mobile/features/camera/data/brain_camera_repository.dart';
import 'package:lefi_mobile/features/brain/data/brain_auth_repository.dart';
import 'package:lefi_mobile/features/brain/data/brain_http.dart';
import 'package:lefi_mobile/features/brain/data/brain_pairing_service.dart';
import 'package:lefi_mobile/features/brain/domain/brain_pairing.dart';
import 'package:lefi_mobile/features/environment/domain/brain_environment.dart';
import 'package:lefi_mobile/features/greenhouse/data/brain_greenhouse_repository.dart';
import 'package:lefi_mobile/features/handover/data/brain_handover_repository.dart';
import 'package:lefi_mobile/features/home/data/brain_dashboard_repository.dart';
import 'package:lefi_mobile/features/profile/data/brain_profile_repository.dart';
import 'package:lefi_mobile/features/robot/application/brain_robots.dart';
import 'package:lefi_mobile/features/robot/data/brain_robot_repository.dart';
import 'package:lefi_mobile/features/robot/domain/brain_robot.dart';
import 'package:lefi_mobile/features/tasks/data/brain_task_repository.dart';
import 'package:lefi_mobile/features/tasks/domain/brain_task.dart';
import 'package:lefi_mobile/shared/domain/role.dart';

final _env = Platform.environment;
String _need(String k) => _env[k] ?? (throw StateError('$k not set: run desktop_gateway_real.sh'));

/// Lefi Brain's own CLI on the temporary state (never an installed Brain).
Map<String, dynamic> brainCli(List<String> args) {
  final env = Map<String, String>.from(Platform.environment)
    ..remove('LEFI_ENV_FILE')
    ..['LEFI_STATE_DIR'] = _need('LEFI_TEST_STATE');
  final p = Process.runSync(
    _need('LEFI_TEST_BRAIN_PY'),
    ['-m', 'lefi_brain', ...args],
    workingDirectory: _need('LEFI_TEST_BRAIN_DIR'),
    environment: env,
    includeParentEnvironment: false,
    stdoutEncoding: utf8,
  );
  try {
    return jsonDecode(p.stdout as String) as Map<String, dynamic>;
  } on FormatException {
    return {'stdout': p.stdout, 'stderr': p.stderr, 'exit': p.exitCode};
  }
}

Future<Map<String, dynamic>> brainCliWithInput(List<String> args, String input) async {
  final env = Map<String, String>.from(Platform.environment)
    ..remove('LEFI_ENV_FILE')
    ..['LEFI_STATE_DIR'] = _need('LEFI_TEST_STATE');
  final p = await Process.start(
    _need('LEFI_TEST_BRAIN_PY'),
    ['-m', 'lefi_brain', ...args],
    workingDirectory: _need('LEFI_TEST_BRAIN_DIR'),
    environment: env,
    includeParentEnvironment: false,
  );
  p.stdin.writeln(input);
  await p.stdin.close();
  final out = await p.stdout.transform(utf8.decoder).join();
  await p.exitCode;
  return jsonDecode(out) as Map<String, dynamic>;
}

void main() {
  final enabled = _env.containsKey('LEFI_TEST_GATEWAY_URL');
  const pw = 'mobile-test-password-1';
  const pw2 = 'mobile-test-password-2';

  test('pair a phone, sign in through mTLS, then the gateway refuses it once revoked', () async {
    final url = _need('LEFI_TEST_GATEWAY_URL');

    // Not paired: the gateway answers health, Lefi Brain refuses everything else, and says why.
    final first = BrainHttp.firstContact();
    final health = await first.call('GET', Uri.parse('$url/api/v1/health'));
    expect(health.status, 200);
    expect(health.json['service'], 'lefi-brain');
    final unpaired = await first.call(
      'POST',
      Uri.parse('$url/api/v1/auth/login'),
      body: {'username': 'x', 'password': 'y'},
    );
    expect(unpaired.status, 401);
    expect(unpaired.error('').code, 'DEVICE_NOT_PAIRED');
    expect(unpaired.error('').reason, 'no_certificate');
    first.close();

    // A wrong code is refused and nothing is kept.
    const service = BrainPairingService();
    await expectLater(
      service.pair(address: url, code: 'ABCD-EFGH-JKMN', deviceName: 'TEST phone'),
      throwsA(isA<BrainException>().having((e) => e.code, 'code', 'PAIRING_REFUSED')),
    );

    final code = brainCli(['pair', 'new', '--json', '--label', 'TEST phone'])['code'] as String;
    final pairing = await service.pair(address: url, code: code, deviceName: 'TEST phone');
    expect(pairing.url, url);
    expect(pairing.keyPem, contains('PRIVATE KEY'));
    // The same code cannot pair a second phone.
    await expectLater(
      service.pair(address: url, code: code, deviceName: 'TEST phone 2'),
      throwsA(isA<BrainException>().having((e) => e.code, 'code', 'PAIRING_REFUSED')),
    );

    // A person with a role signs in with their username, through the device certificate.
    final added = await brainCliWithInput([
      'user',
      'add',
      'mobile.grower',
      '--role',
      'grower',
      '--name',
      'TEST Grower',
      '--password-stdin',
      '--json',
    ], pw);
    expect(added['username'], 'mobile.grower');
    final auth = BrainAuthRepository(pairing);
    await expectLater(
      auth.signIn('mobile.grower', 'wrong-password-123'),
      throwsA(isA<AuthException>().having((e) => e.message, 'message', 'Wrong username or password.')),
    );
    UserProfile user;
    var current = pw;
    try {
      user = await auth.signIn('mobile.grower', pw);
    } on PasswordChangeRequired {
      user = await auth.changePassword(pw, pw2);
      current = pw2;
    }
    expect(user.fromBrain, isTrue);
    expect(user.name, 'TEST Grower');
    expect(user.role, Role.grower);
    expect(user.roleName, 'Grower / Crop Manager');
    expect(auth.permissions, contains('nav.greenhouses'));
    expect(auth.permissions, isNot(contains('user.manage')));

    // The Lefi AI assistant answers this phone through the gateway too (ADR-067).
    final http = BrainHttp.paired(pairing);
    final login = await http.call(
      'POST',
      Uri.parse('$url/api/v1/auth/login'),
      body: {'username': 'mobile.grower', 'password': current, 'token_transport': 'bearer'},
    );
    expect(login.status, 200, reason: '${login.body}');
    final token = login.json['token'] as String;
    final ai = await http.call('GET', Uri.parse('$url/api/v1/ai/assistant'), token: token);
    expect(ai.status, 200, reason: '${ai.body}');
    expect(ai.json['can_write'], isFalse);
    final tools = [for (final t in ai.json['tools'] as List) (t as Map)['name']];
    expect(tools, contains('current_readings'));
    expect(tools, isNot(contains('field_devices'))); // a grower has no nav.devices
    http.close();
    await auth.signOut();

    // Revoked on the main PC: the next sign-in says so, in words.
    final revoked = brainCli(['pair', 'revoke', pairing.deviceId, '--json', '--reason', 'TEST']);
    expect(revoked['status'], 'revoked', reason: '$revoked');
    final after = BrainAuthRepository(pairing);
    await expectLater(
      after.signIn('mobile.grower', current),
      throwsA(isA<AuthException>().having((e) => e.message, 'message', contains('removed this phone'))),
    );
    after.close();
    auth.close();
  }, skip: enabled ? false : 'needs a real Lefi Brain and Caddy: scripts/tests/desktop_gateway_real.sh');

  test('pairs by IP address as well (no name to resolve)', () async {
    final url = _need('LEFI_TEST_GATEWAY_URL_IP');
    final code = brainCli(['pair', 'new', '--json', '--label', 'TEST phone by IP'])['code'] as String;
    final pairing = await const BrainPairingService().pair(address: url, code: code, deviceName: 'TEST phone IP');
    final http = BrainHttp.paired(pairing);
    final login = await http.call(
      'POST',
      Uri.parse('$url/api/v1/auth/login'),
      body: {'username': 'x', 'password': 'y'},
    );
    // Recognised as a paired device: the refusal is now about the person, not the phone.
    expect(login.status, 401, reason: '${login.body}');
    expect(login.error('').code, 'INVALID_CREDENTIALS');
    http.close();
  }, skip: enabled ? false : 'needs a real Lefi Brain and Caddy: scripts/tests/desktop_gateway_real.sh');

  test('people of each role do the five tabs, the shift handover, AI control, zone cameras, the robot, the Lefi AI chat, environmental monitoring and plant summaries on the real Lefi Brain through the gateway (ADR-100, 101, 102, 103, 106, 107, 108, 109)', () async {
    final url = _need('LEFI_TEST_GATEWAY_URL');
    final code = brainCli(['pair', 'new', '--json', '--label', 'TEST phone tabs'])['code'] as String;
    final pairing = await const BrainPairingService().pair(address: url, code: code, deviceName: 'TEST phone tabs');

    Future<BrainAuthRepository> person(String username, String role) async {
      final added = await brainCliWithInput([
        'user',
        'add',
        username,
        '--role',
        role,
        '--name',
        'TEST ${role[0].toUpperCase()}${role.substring(1)}',
        '--password-stdin',
        '--json',
      ], pw);
      expect(added['username'], username, reason: '$added');
      final auth = BrainAuthRepository(pairing);
      try {
        await auth.signIn(username, pw);
      } on PasswordChangeRequired {
        await auth.changePassword(pw, pw2);
      }
      expect(auth.userId, added['id']);
      return auth;
    }

    final admin = await person('tabs.admin', 'admin');
    final sup = await person('tabs.sup', 'supervisor');
    final worker = await person('tabs.worker', 'worker');
    final scout = await person('tabs.scout', 'scout');

    // An administrator sets up the place (Lefi Desktop does this in real life).
    Future<Map<String, dynamic>> post(BrainAuthRepository a, String path, Object body) async =>
        (await a.api('POST', path, body: body)).json;
    final gh = await post(admin, '/greenhouses', {'name': 'TEST Greenhouse'});
    final zone = await post(admin, '/zones', {
      'greenhouse_id': gh['id'],
      'name': 'TEST Zone A',
      'code': 'TZA',
      'purpose': 'production',
    });
    final crop = await post(admin, '/crop-types', {'name': 'TEST Lettuce'});
    final plant = await post(admin, '/plants', {'code': 'TP-001', 'crop_type_id': crop['id'], 'zone_id': zone['id']});

    // Greenhouse: every role reads it; plant health only for roles that see it.
    final ghWorker = BrainGreenhouseRepository(worker);
    expect((await ghWorker.greenhouses()).map((g) => g.name), contains('TEST Greenhouse'));
    final zones = await ghWorker.zones();
    final z = zones.firstWhere((x) => x.id == zone['id']);
    expect(z.title, 'TEST Zone A · TZA');
    expect(z.plants, 1);
    final env = await ghWorker.environment(zoneId: z.id);
    expect(env.zoneId, z.id);
    expect(env.values, isEmpty); // no sensor added: nothing invented
    expect((await ghWorker.plants(zoneId: z.id)).single.code, 'TP-001');
    expect(await ghWorker.plantHealth(), isNull);
    expect(await ghWorker.observations(plant['id'] as String), isEmpty);

    // A supervisor asks for an inspection; the scout's observation closes it.
    final ghSup = BrainGreenhouseRepository(sup);
    final req = await ghSup.requestInspection(plant['id'] as String, reason: 'TEST yellow leaves');
    expect(req.status, 'open');
    final ghScout = BrainGreenhouseRepository(scout);
    final board = (await ghScout.plantHealth())!;
    expect(board.canObserve, isTrue);
    expect(board.rows[plant['id']]!.openRequest!.reason, 'TEST yellow leaves');
    final closed = await ghScout.recordObservation(
      plant['id'] as String,
      health: 'watch',
      issues: ['water'],
      note: 'TEST dry substrate',
    );
    expect(closed, 1);
    final obs = await ghScout.observations(plant['id'] as String);
    expect(obs.single.health, 'watch');
    expect(obs.single.observedBy, 'TEST Scout');
    // A worker may not record one: Lefi Brain refuses, whatever the phone shows.
    await expectLater(
      ghWorker.recordObservation(plant['id'] as String, health: 'healthy'),
      throwsA(isA<AuthException>()),
    );

    // Tasks: the supervisor makes one for the worker; the worker does it with a photo; the supervisor
    // verifies it. The worker cannot verify.
    final supTasks = BrainTaskRepository(sup);
    final made = await supTasks.create(
      NewTask(
        title: 'TEST check the drip line',
        kind: 'check_environment',
        priority: 'high',
        zoneId: z.id,
        assignedTo: worker.userId,
        dueAt: DateTime.now().add(const Duration(hours: 3)),
      ),
    );
    expect(made.number, startsWith('T-'));
    expect(made.zone, 'TEST Zone A');
    final workerTasks = BrainTaskRepository(worker);
    final list = await workerTasks.list(status: 'all');
    expect(list.canSeeAll, isFalse);
    final mine = list.tasks.where((t) => t.isMine(worker.userId, worker.roleId)).toList();
    expect(mine.map((t) => t.id), [made.id]);
    expect((await workerTasks.start(made.id)).status, 'in_progress');
    // 1×1 PNG (Lefi Brain checks the bytes, not a name).
    final png = base64Decode(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    );
    final photo = await workerTasks.addPhoto(made.id, png, note: 'TEST after');
    expect(photo.contentType, 'image/png');
    expect((await workerTasks.photos(made.id)).single.id, photo.id);
    expect(await workerTasks.photoBytes(photo.id), png);
    expect((await workerTasks.complete(made.id, 'TEST emitter cleaned')).status, 'awaiting');
    await expectLater(workerTasks.verify(made.id, null), throwsA(isA<AuthException>()));
    final verified = await supTasks.verify(made.id, 'TEST looks good');
    expect(verified.status, 'verified');
    expect(verified.outcome, 'TEST emitter cleaned');
    expect(verified.verifiedBy, 'TEST Supervisor');

    // Home: a worker (no overview) sees their tasks; none is left to do now.
    final home = await BrainDashboardRepository(worker)
        .dashboardFor(_profileOf('TEST Worker', Role.worker), const [], (_) => true);
    expect(home.hero.label, 'My tasks');
    expect(home.hero.value, '0');
    expect(home.unavailable, isEmpty);

    // Profile: the worker's own shift from the roster the supervisor keeps; notification level.
    await sup.api('PUT', '/shifts/timezone', body: {'timezone': 'UTC'});
    final type = await post(sup, '/shifts/types', {'name': 'TEST Day', 'start': '00:00', 'end': '23:59'});
    final today = DateTime.now().toUtc();
    final day = '${today.year}-${today.month.toString().padLeft(2, '0')}-${today.day.toString().padLeft(2, '0')}';
    await sup.api(
      'PUT',
      '/shifts/assignments',
      body: {'user_id': worker.userId, 'day': day, 'shift_type_id': type['id']},
    );
    final profile = BrainProfileRepository(worker);
    final shifts = (await profile.myShifts())!;
    expect(shifts.timezone, 'UTC');
    expect(shifts.days.first.today, isTrue);
    expect(shifts.days.first.shift!.name, 'TEST Day');
    if (today.hour < 23) expect(shifts.now!.name, 'TEST Day');
    expect(await profile.setNotificationLevel('critical'), 'critical');
    expect(await profile.notificationLevel(), 'critical');
    // Another person's roster never reaches the phone.
    expect((await BrainProfileRepository(scout).myShifts())!.days.every((d) => d.shift == null), isTrue);

    // Shift handover (ADR-095, 101): the worker's running shift is the outgoing one. The supervisor
    // signs; who signed cannot acknowledge; the administrator acknowledges; a worker cannot read it.
    final hoSup = BrainHandoverRepository(sup);
    final view = await hoSup.current();
    expect(view.state, 'ready', reason: '${view.reason}');
    expect(view.outgoing!.name, 'TEST Day');
    expect(view.outgoing!.people.map((p) => p.name), contains('TEST Worker'));
    expect(view.canSign && view.canAcknowledge, isTrue);
    final ho = view.handover!;
    expect(ho.status, 'open');
    expect(ho.tasksDone.map((t) => t.title), contains('TEST check the drip line'));
    expect(['pending', 'done', 'invalid', 'unavailable', 'failed'], contains(ho.summary.status));
    final signed = await hoSup.sign(ho.id, 'TEST all quiet');
    expect(signed.status, 'signed');
    expect(signed.signedBy, 'TEST Supervisor');
    expect(signed.signNote, 'TEST all quiet');
    await expectLater(hoSup.acknowledge(ho.id, null), throwsA(isA<AuthException>()));
    final acked = await BrainHandoverRepository(admin).acknowledge(ho.id, 'TEST received');
    expect(acked.status, 'acknowledged');
    expect(acked.acknowledgedBy, 'TEST Admin');
    expect((await hoSup.recent()).first.id, ho.id);
    await expectLater(BrainHandoverRepository(worker).current(), throwsA(isA<AuthException>()));

    // AI control & safety (ADR-085, 102): the supervisor stops Lefi AI with a reason (the flag lives
    // in this test's own state folder) but cannot resume it; the administrator resumes; a worker
    // cannot read it but sees the stop.
    final aiSup = BrainAiControlRepository(sup);
    final before = await aiSup.control();
    expect(before.canStop, isTrue);
    expect(before.canResume, isFalse);
    expect(before.parts.where((p) => !p.needsAi).map((p) => p.name), contains('Rules engine and alerts'));
    await expectLater(aiSup.stop('no'), throwsA(isA<AuthException>()));
    final stopped = await aiSup.stop('TEST crew in the zone');
    expect(stopped.stopped, isTrue);
    expect(stopped.stoppedNote, contains('TEST crew in the zone'));
    // The worker (no `/overview`) sees it in `/ai/assistant`; the scout's Home sees it too.
    expect((await worker.api('GET', '/ai/assistant')).json['kill_switch'], isTrue);
    final scoutHome = await BrainDashboardRepository(scout)
        .dashboardFor(_profileOf('TEST Scout', Role.scout), const [], (_) => true);
    expect(scoutHome.ai!.stopped, isTrue);
    await expectLater(aiSup.resume(), throwsA(isA<AuthException>()));
    await expectLater(BrainAiControlRepository(worker).control(), throwsA(isA<AuthException>()));
    final resumed = await BrainAiControlRepository(admin).resume();
    expect(resumed.stopped, isFalse);
    expect(resumed.stoppedNote, isNull);

    // Zone cameras, read only (ADR-103): the test Lefi Brain has no USB camera, so the supervisor
    // reads empty lists of the zone's cameras, photos and Lefi AI's analyses; a worker is refused.
    final camSup = BrainCameraRepository(sup);
    expect((await camSup.cameras()).where((c) => c.looksAt(z.id)), isEmpty);
    expect(await camSup.zonePhotos(z.id), isEmpty);
    expect(await camSup.analyses(const []), isEmpty);
    await expectLater(BrainCameraRepository(worker).cameras(), throwsA(isA<AuthException>()));

    // The simulated robot, read only (ADR-106): the script runs the bridge's TEST-only lite backend.
    // The supervisor asks for a mission as Lefi Desktop does; the scout (`nav.robots`, no
    // `robot.command`) follows what it does, the command it runs and where it is; a worker is refused.
    final robScout = BrainRobotRepository(scout);
    var robot = (await robScout.robots()).single;
    for (var i = 0; !robot.online && i < 40; i++) {
      await Future<void>.delayed(const Duration(milliseconds: 500));
      robot = (await robScout.robots()).single;
    }
    expect(robot.online, isTrue, reason: 'the lite bridge never answered Lefi Brain');
    expect(robot.origin, 'SIMULATED');
    final scene = (await robScout.scene(robot.id))!;
    final station = scene.stations.firstWhere((s) => s.kind != 'dock');
    await expectLater(
      scout.api('POST', '/robot-missions', body: {'robot_id': robot.id, 'kind': 'inspect', 'station_id': station.id}),
      throwsA(isA<AuthException>()),
    );
    final asked = await sup.api(
      'POST',
      '/robot-missions',
      body: {'robot_id': robot.id, 'kind': 'inspect', 'station_id': station.id},
    );
    final missionId = asked.json['id'] as String;
    var sawDriving = false;
    var sawGoTo = false;
    String? finalState;
    for (var i = 0; i < 240 && finalState == null; i++) {
      await Future<void>.delayed(const Duration(milliseconds: 500));
      final r = (await robScout.robots()).single;
      final live = RobotLive(robot: r, commands: await robScout.commands(r.id), missions: const [], scene: scene);
      if (r.mission?.id == missionId && r.mission!.state == 'NAVIGATING') sawDriving = true;
      final c = live.current;
      if (c != null && c.kind == 'go_to' && commandLabel(c, scene) == 'Go to ${station.label}') sawGoTo = true;
      final m = (await robScout.missions(r.id)).firstWhere((m) => m.id == missionId);
      if (!m.active) finalState = m.state;
    }
    expect(finalState, 'COMPLETED');
    expect(sawDriving, isTrue);
    expect(sawGoTo, isTrue);
    final after = (await robScout.robots()).single;
    expect(robotWhere(after.state!.pose, scene), 'At ${station.label}');
    final cmds = await robScout.commands(after.id);
    expect(cmds.map((c) => c.kind), containsAll(['go_to', 'look']));
    expect(cmds.every((c) => c.actor == 'lefi-brain'), isTrue);

    // Cancel and the safe stop from the phone (ADR-106): the scout cannot ask for missions but may
    // always stop one (ADR-091). Each time Lefi Brain sends `stop` for the scout.
    final back = scene.stations.firstWhere((s) => s.id != station.id);
    Future<String> ask() async =>
        (await sup.api(
              'POST',
              '/robot-missions',
              body: {'robot_id': robot.id, 'kind': 'go_to', 'station_id': back.id},
            )).json['id']
            as String;
    final toCancel = await ask();
    final cancelled = await robScout.cancelMission(toCancel);
    expect(cancelled.state, 'CANCELLED');
    expect(cancelled.active, isFalse);
    final stopCmds = (await robScout.commands(robot.id)).where((c) => c.missionId == toCancel && c.kind == 'stop');
    expect(stopCmds.single.actor, startsWith('user:'));
    expect(commandActorLabel(stopCmds.single.actor), 'A person');

    final toStop = await ask();
    final stop = await robScout.safeStop(robot.id);
    expect(stop.kind, 'stop');
    expect(stop.actor, startsWith('user:'));
    final stoppedMission = (await robScout.missions(robot.id)).firstWhere((m) => m.id == toStop);
    expect(stoppedMission.state, 'CANCELLED');
    expect(stoppedMission.events.last.note, 'safe stop');
    expect((await robScout.robots()).single.mission, isNull);
    await expectLater(BrainRobotRepository(worker).safeStop(robot.id), throwsA(isA<AuthException>()));
    await expectLater(BrainRobotRepository(worker).robots(), throwsA(isA<AuthException>()));

    // Lefi AI's chat (ADR-067, 107): every role may ask. The script's TEST-only fake AI node asks Lefi
    // Brain for `greenhouse_overview` (`nav.greenhouses`), then quotes what the tool returned (it is
    // not a model). A conversation belongs to the person who asked.
    Future<ChatConversation> answered(BrainChatRepository chat, String question, {String? id}) async {
      var c = await chat.ask(question, conversationId: id);
      expect(c.messages.last.thinking, isTrue);
      for (var i = 0; i < 60 && c.thinking; i++) {
        await Future<void>.delayed(const Duration(milliseconds: 500));
        c = await chat.conversation(c.id);
      }
      return c;
    }

    final chatSup = BrainChatRepository(sup);
    final st = await chatSup.status();
    expect(st.available, isTrue, reason: st.reason);
    expect(st.has('greenhouse_overview'), isTrue);
    final c1 = await answered(chatSup, 'TEST how is the greenhouse?');
    final a1 = c1.messages.last;
    expect(a1.state, 'done', reason: a1.error);
    expect(a1.content, startsWith('TEST fake AI read:'));
    expect(a1.model, st.model);
    expect(a1.read, isNotEmpty);
    final c2 = await answered(chatSup, 'TEST and now?', id: c1.id);
    expect(c2.id, c1.id);
    expect(c2.messages.where((m) => m.fromPerson).length, 2);
    expect((await chatSup.conversations()).map((c) => c.id), contains(c1.id));

    final chatWorker = BrainChatRepository(worker);
    final cw = await answered(chatWorker, 'TEST how is the greenhouse?');
    final aw = cw.messages.last;
    expect(aw.state, 'done', reason: aw.error);
    expect(aw.content, startsWith('TEST fake AI read:'));
    expect((await chatWorker.conversations()).map((c) => c.id), isNot(contains(c1.id)));
    // A person reads only their own conversations.
    await expectLater(chatWorker.conversation(c1.id), throwsA(isA<AuthException>()));

    // A plant's summary (ADR-109): the scout opens it by the plant's id (and by its code), sees the
    // scout's own observation, and asks Lefi AI (the script's TEST-only fake node) for a summary.
    final pid = plant['id'] as String;
    final ghScoutRepo = BrainGreenhouseRepository(scout);
    final ps = await ghScoutRepo.plantSummary(pid);
    expect(ps.code, 'TP-001');
    expect((await ghScoutRepo.plantSummary('tp-001')).id, pid);
    expect(ps.latestHealth, isNotNull);
    expect(ps.history, isNotEmpty);
    var ai = await ghScoutRepo.askPlantAiSummary(pid);
    expect(ai.status, anyOf('pending', 'done'));
    for (var i = 0; i < 40 && ai.pending; i++) {
      await Future<void>.delayed(const Duration(milliseconds: 250));
      ai = await ghScoutRepo.plantAiSummary(pid);
    }
    expect(ai.status, 'done', reason: ai.error);
    expect(ai.summary, startsWith('TEST fake AI summary'));
    expect(ai.model, isNotNull);
    expect((await BrainGreenhouseRepository(worker).plantAiSummary(pid)).status, 'none');

    // Environmental Monitoring (ADR-084, 108): every role reads a zone over a window; the test Lefi
    // Brain has no sensor in it, so there is nothing to draw, nothing is invented, irrigation says why.
    for (final who in [scout, worker]) {
      final env = BrainEnvironment.fromJson((await who.api('GET', '/environment?zone_id=${z.id}&range=7d')).json);
      expect(env.zoneId, z.id);
      expect(env.range, '7d');
      expect(env.zones.map((x) => x.id), contains(z.id));
      expect(env.values, isEmpty);
      expect(env.series.every((x) => x.empty), isTrue);
      expect(env.irrigation, isNotEmpty);
    }

    for (final a in [admin, sup, worker, scout]) {
      await a.signOut();
      a.close();
    }
  }, skip: enabled ? false : 'needs a real Lefi Brain and Caddy: scripts/tests/desktop_gateway_real.sh');
}

UserProfile _profileOf(String name, Role role) => UserProfile(
  role: role,
  roleName: name,
  short: name,
  name: name,
  email: '',
  colorValue: 0,
  greenhouseScope: 'Lefi Brain',
  shiftLabel: '',
  shiftStartHour: 0,
  shiftEndHour: 24,
  reportsTo: '',
  zones: const [],
  nextShift: '',
  fromBrain: true,
);
