import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { DatabaseService } from './database/database.service.js';

describe('AppController', () => {
  let appController: AppController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        AppService,
        { provide: DatabaseService, useValue: { enabled: false } },
      ],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  it('saude sem BD responde ok com bd=false', async () => {
    await expect(appController.saude()).resolves.toEqual({
      ok: true,
      bd: false,
    });
  });
});
