import '../../brain/data/brain_json.dart';

/// Lefi Brain's limit for one question (`MAX_QUESTION_CHARS`, ADR-067).
const chatMaxChars = 2000;

/// What Lefi AI may read for this person (`/ai/assistant` tools: only what the role allows).
class ChatTool {
  const ChatTool(this.name, this.label);
  final String name;
  final String label;
}

/// Whether Lefi AI can answer now, with which model, and what it may read for this person.
class ChatStatus {
  const ChatStatus({
    required this.state,
    required this.reason,
    required this.killSwitch,
    required this.tools,
    this.model,
  });
  factory ChatStatus.fromJson(Map<String, dynamic> j) => ChatStatus(
    state: js(j['state'], 'unknown'),
    reason: js(j['reason']),
    model: jsn(j['model']),
    killSwitch: jb(j['kill_switch']),
    tools: [for (final t in jl(j['tools'])) ChatTool(js(t['name']), js(t['label'], humanize(js(t['name']))))],
  );
  final String state;
  final String reason;
  final String? model;
  final bool killSwitch;
  final List<ChatTool> tools;

  bool get available => state == 'available' && !killSwitch;
  bool has(String tool) => tools.any((t) => t.name == tool);
}

/// One thing Lefi AI read (or tried to) for an answer, as Lefi Brain recorded it.
class ChatToolUse {
  const ChatToolUse({required this.name, required this.label, required this.outcome, this.detail});
  factory ChatToolUse.fromJson(Map<String, dynamic> j) => ChatToolUse(
    name: js(j['name']),
    label: js(j['label'], humanize(js(j['name']))),
    outcome: js(j['outcome'], 'error'),
    detail: jsn(j['detail']),
  );
  final String name;
  final String label;

  /// ok · denied · invalid · not_found · error
  final String outcome;
  final String? detail;
}

class ChatMessage {
  const ChatMessage({
    required this.id,
    required this.fromPerson,
    required this.content,
    required this.state,
    required this.tools,
    this.at,
    this.model,
    this.error,
  });
  factory ChatMessage.fromJson(Map<String, dynamic> j) => ChatMessage(
    id: js(j['id']),
    fromPerson: j['role'] == 'user',
    content: js(j['content']),
    state: js(j['state'], 'done'),
    at: jt(j['created_at']),
    model: jsn(j['model']),
    error: jsn(j['error']),
    tools: [for (final t in jl(j['tools'])) ChatToolUse.fromJson(t)],
  );
  final String id;
  final bool fromPerson;
  final String content;

  /// thinking · done · failed
  final String state;
  final DateTime? at;
  final String? model;
  final String? error;
  final List<ChatToolUse> tools;

  bool get thinking => state == 'thinking';

  /// Labels of what Lefi AI read for this answer, once each.
  List<String> get read => {
    for (final t in tools)
      if (t.outcome == 'ok') t.label,
  }.toList();

  /// What the person's role does not let Lefi AI read.
  List<String> get denied => {
    for (final t in tools)
      if (t.outcome == 'denied') t.label,
  }.toList();

  /// Photos Lefi AI took for this answer (ADR-079): `photo:<id>` in the tool's detail.
  List<String> get photoIds => [
    for (final t in tools)
      if (t.outcome == 'ok' && (t.detail?.startsWith('photo:') ?? false)) t.detail!.substring('photo:'.length),
  ];

  /// Lefi AI aimed or zoomed a camera a person allowed (ADR-079).
  bool get movedCamera => tools.any((t) => t.name == 'camera_control' && t.outcome == 'ok');
}

class ChatConversationSummary {
  const ChatConversationSummary({required this.id, required this.title, this.updatedAt});
  factory ChatConversationSummary.fromJson(Map<String, dynamic> j) =>
      ChatConversationSummary(id: js(j['id']), title: js(j['title'], 'Conversation'), updatedAt: jt(j['updated_at']));
  final String id;
  final String title;
  final DateTime? updatedAt;
}

class ChatConversation {
  const ChatConversation({required this.id, required this.title, required this.messages});
  factory ChatConversation.fromJson(Map<String, dynamic> j) => ChatConversation(
    id: js(j['id']),
    title: js(j['title'], 'Conversation'),
    messages: [for (final m in jl(j['messages'])) ChatMessage.fromJson(m)],
  );
  final String id;
  final String title;
  final List<ChatMessage> messages;

  bool get thinking => messages.any((m) => m.thinking);
}

/// A piece of an answer's text: `**bold**` is the only mark the phone draws.
typedef ChatSpan = ({String text, bool bold});

/// Lefi AI's answer split into lines (bullets kept: "- " / "* " / "1. ") and bold spans. Headings lose
/// their `#`. Nothing is executed or linked.
List<({bool bullet, String marker, List<ChatSpan> spans})> chatLines(String text) {
  final out = <({bool bullet, String marker, List<ChatSpan> spans})>[];
  for (final raw in text.replaceAll('\r', '').split('\n')) {
    var line = raw.trimRight();
    if (line.trim().isEmpty) continue;
    var bullet = false;
    var marker = '';
    final t = line.trimLeft();
    final b = RegExp(r'^([-*•]|\d+[.)])\s+').firstMatch(t);
    if (b != null) {
      bullet = true;
      final m = b.group(1)!;
      marker = RegExp(r'^\d').hasMatch(m) ? m : '•';
      line = t.substring(b.end);
    } else {
      line = t.replaceFirst(RegExp(r'^#{1,6}\s+'), '');
    }
    final spans = <ChatSpan>[];
    final parts = line.split('**');
    for (var i = 0; i < parts.length; i++) {
      if (parts[i].isEmpty) continue;
      spans.add((text: parts[i], bold: i.isOdd && i < parts.length - 1));
    }
    out.add((bullet: bullet, marker: marker, spans: spans));
  }
  return out;
}
