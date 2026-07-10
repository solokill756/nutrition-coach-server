import { WeightItemResponseDto } from "./weight-item-response.dto";
import { WeightStatsDto } from "./weight-stats.dto";

export class WeightListResponseDto {
  items!: WeightItemResponseDto[];
  total!: number;
  stats!: WeightStatsDto;
}
