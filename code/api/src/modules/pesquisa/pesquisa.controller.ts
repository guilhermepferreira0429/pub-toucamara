import { Controller, Get, Query } from '@nestjs/common';
import { MunicipioAtual, UtilizadorAtual } from '../../common/pedido.js';
import type { UtilizadorPainel } from '../../common/pedido.js';
import { validar } from '../../common/validacao.js';
import { Painel } from '../auth/painel.guard.js';
import type { Municipio } from '../municipios/municipios.service.js';
import { esquemaPesquisa, PesquisaService } from './pesquisa.service.js';

/**
 * Painel · pesquisa global (⌘K). Só exige sessão: cada área entra ou não
 * conforme a permissão do perfil (no serviço), como na barra lateral.
 */
@Controller('painel/pesquisa')
@Painel()
export class PesquisaController {
  constructor(private readonly pesquisa: PesquisaService) {}

  /** ?q=texto, número ('CP 2/2026', 'OC-0381') ou telefone. */
  @Get()
  pesquisar(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Query() query: unknown,
  ) {
    return this.pesquisa.pesquisar(m, u, validar(esquemaPesquisa, query).q);
  }
}
