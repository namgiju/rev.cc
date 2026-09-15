package com.revcc.app;
import org.springframework.web.bind.annotation.*;
import java.util.List;
@RestController
@RequestMapping("/api/vehicles")
@CrossOrigin(origins = "http://localhost:3000")
public class VehicleController {
  private final VehicleRepository repository;

  // 저장소를 주입하여 응답 JSON은 유지하면서 영구 데이터로 조회한다.
  public VehicleController(VehicleRepository repository) { this.repository = repository; }

  @GetMapping
  public List<VehicleResponse> vehicles(){
    return repository.findAll();
  }
  public record VehicleResponse(Long id,String brand,String model,int year,int power){}
}
