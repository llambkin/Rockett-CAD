#include "Adaptive.hpp"
#include <vector>

namespace
{

std::vector<double> output;

AdaptivePath::DPaths readPaths(const double*& input)
{
    AdaptivePath::DPaths paths(static_cast<size_t>(*input++));
    for (auto& path : paths) {
        path.resize(static_cast<size_t>(*input++));
        for (auto& point : path) {
            point.first = *input++;
            point.second = *input++;
        }
    }
    return paths;
}

double warnings(const AdaptivePath::AdaptiveOutput& region)
{
    return double(
        region.StartPointNotFound | region.LeadPathFailed << 1 | region.UnexpectedRotateIterations << 2
        | region.TooManyFailedEngagements << 3 | region.UnclearedAreaRemains << 4
        | region.FailedToSetUpFinishingPass << 5 | region.FinishingLeadInFailed << 6
    );
}

void writeRegion(const AdaptivePath::AdaptiveOutput& region)
{
    output.insert(
        output.end(),
        {region.HelixCenterPoint.first,
         region.HelixCenterPoint.second,
         region.StartPoint.first,
         region.StartPoint.second,
         double(region.ReturnMotionType),
         region.ClearedArea,
         warnings(region),
         double(region.AdaptivePaths.size())}
    );
    for (const auto& [motion, points] : region.AdaptivePaths) {
        output.push_back(double(motion));
        output.push_back(double(points.size()));
        for (const auto& [x, y] : points) {
            output.push_back(x);
            output.push_back(y);
        }
    }
}

}

extern "C" const double* adaptive(const double* input)
{
    AdaptivePath::Adaptive2d engine;
    engine.toolDiameter = *input++;
    engine.helixRampTargetDiameter = *input++;
    engine.helixRampMinDiameter = *input++;
    engine.stepOverFactor = *input++;
    engine.tolerance = *input++;
    engine.stockToLeave = *input++;
    engine.forceInsideOut = *input++ != 0;
    engine.finishingProfile = *input++ != 0;
    engine.keepToolDownDistRatio = *input++;
    engine.opType = static_cast<AdaptivePath::OperationType>(*input++);
    const AdaptivePath::DPaths stock = readPaths(input);
    const AdaptivePath::DPaths paths = readPaths(input);
    const AdaptivePath::DPaths cleared = readPaths(input);
    const auto regions = engine.Execute(stock, paths, cleared, [](AdaptivePath::TPaths) {
        return false;
    });
    output = {0, double(regions.size())};
    for (const auto& region : regions) {
        writeRegion(region);
    }
    output[0] = double(output.size());
    return output.data();
}
