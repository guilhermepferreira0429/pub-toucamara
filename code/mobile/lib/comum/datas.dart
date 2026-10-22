/// Datas em português de Portugal, sem depender de dados de localização.
const _dias = [
  'segunda-feira',
  'terça-feira',
  'quarta-feira',
  'quinta-feira',
  'sexta-feira',
  'sábado',
  'domingo',
];
const _meses = [
  'janeiro',
  'fevereiro',
  'março',
  'abril',
  'maio',
  'junho',
  'julho',
  'agosto',
  'setembro',
  'outubro',
  'novembro',
  'dezembro',
];

String _dois(int n) => n.toString().padLeft(2, '0');

/// "quarta-feira, 22 de outubro".
String diaPorExtenso(DateTime d) =>
    '${_dias[d.weekday - 1]}, ${d.day} de ${_meses[d.month - 1]}';

/// "2026-10-22" → "22/10".
String diaCurto(String iso) {
  final d = DateTime.tryParse(iso);
  return d == null ? iso : '${_dois(d.day)}/${_dois(d.month)}';
}

/// "10:32".
String hora(DateTime d) {
  final l = d.toLocal();
  return '${_dois(l.hour)}:${_dois(l.minute)}';
}

/// "22/10 às 10:32" (ou "hoje às 10:32").
String quando(DateTime d, {DateTime? agora}) {
  final l = d.toLocal();
  final a = (agora ?? DateTime.now()).toLocal();
  final hoje = l.year == a.year && l.month == a.month && l.day == a.day;
  return hoje
      ? 'hoje às ${hora(l)}'
      : '${_dois(l.day)}/${_dois(l.month)} às ${hora(l)}';
}
