package com.revcc.app;
import org.springframework.web.bind.annotation.*;
import java.util.List;
@RestController
@RequestMapping("/api/vehicles")
@CrossOrigin(origins = "http://localhost:3000")
public class VehicleController {
  @GetMapping
  public List<VehicleResponse> vehicles(){
    return List.of(new VehicleResponse(1L,"Hyundai","Avante N",2024,280),new VehicleResponse(2L,"BMW","320i",2018,184));
  }
  public record VehicleResponse(Long id,String brand,String model,int year,int power){}
}
