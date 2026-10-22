import 'armazem.dart';
import 'ficheiros.dart';

GuardaFicheiros criarGuardaFicheiros(Armazem armazem) =>
    GuardaFicheirosArmazem(armazem);
