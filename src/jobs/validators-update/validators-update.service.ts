import { CronJob } from 'cron';
import { Inject, Injectable } from '@nestjs/common';
// import { OneAtTime } from '@lido-nestjs/decorators';
import { LOGGER_PROVIDER, LoggerService } from 'common/logger';
import { PrometheusService } from 'common/prometheus';
import { ConfigService } from 'common/config';
import { JobService } from 'common/job';
import { ValidatorsService } from 'validators';
import { OneAtTime } from 'common/decorators/oneAtTime';

export interface ValidatorsFilter {
  pubkeys: string[];
  statuses: string[];
  max_amount: number | undefined;
  percent: number | undefined;
}

@Injectable()
export class ValidatorsUpdateService {
  constructor(
    @Inject(LOGGER_PROVIDER) protected readonly logger: LoggerService,
    protected readonly prometheusService: PrometheusService,
    protected readonly configService: ConfigService,
    protected readonly jobService: JobService,
    protected readonly validatorsService: ValidatorsService,
  ) {}

  protected lastBlockTimestamp: number | undefined = undefined;
  protected lastBlockNumber: number | undefined = undefined;
  protected lastSlot: number | undefined = undefined;

  public isDisabledRegistry() {
    return !this.configService.get('VALIDATOR_REGISTRY_ENABLE');
  }

  public async initialize() {
    await this.updateValidators();

    const cronTime = this.configService.get('JOB_INTERVAL_VALIDATORS_REGISTRY');
    const job = new CronJob(cronTime, () => {
      this.logger.log(`Cron job cycle start`, { cronTime, name: 'ValidatorsUpdateService' });
      this.updateValidators().catch((error) => this.logger.error(error));
    });
    job.start();

    this.logger.log('Service initialized', { service: 'validators-registry', cronTime });
  }

  @OneAtTime()
  private async updateValidators() {
    await this.jobService.wrapJob({ name: 'Update validators from ValidatorsRegistry' }, async () => {
      const meta = await this.validatorsService.updateValidators('finalized');
      // meta shouldnt be null
      // if update didnt happen, meta will be fetched from db
      this.lastBlockTimestamp = meta?.timestamp ?? this.lastBlockTimestamp;
      this.lastBlockNumber = meta?.blockNumber ?? this.lastBlockNumber;
      this.lastSlot = meta?.slot ?? this.lastSlot;
      this.updateMetrics();
    });
  }

  private updateMetrics() {
    if (this.lastBlockTimestamp) {
      this.prometheusService.validatorsRegistryLastTimestampUpdate.set(this.lastBlockTimestamp);
    }

    if (this.lastBlockNumber) {
      this.prometheusService.validatorsRegistryLastBlockNumber.set(this.lastBlockNumber);
    }
    if (this.lastSlot) {
      this.prometheusService.validatorsRegistryLastSlot.set(this.lastSlot);
    }

    this.logger.log('ValidatorsRegistry metrics updated');
  }
}
