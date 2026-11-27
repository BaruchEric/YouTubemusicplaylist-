package com.cratesync.ui.components

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.cratesync.core.DailyListeningPoint
import com.cratesync.core.GenreSlice
import com.cratesync.core.HeatmapCell
import com.cratesync.core.WeeklyAddedPoint
import com.cratesync.core.WeeklyHabitPoint
import com.cratesync.ui.theme.CrateColors
import com.cratesync.ui.theme.CrateType
import com.cratesync.ui.theme.StudioPanel

/**
 * 1 & 2. Genre Distribution & Global Genre Distribution Donut Chart (Compose Canvas).
 */
@Composable
fun GenreDistributionChartCard(
    title: String,
    subtitle: String,
    slices: List<GenreSlice>,
    modifier: Modifier = Modifier,
) {
    StudioPanel(modifier = modifier.padding(2.dp)) {
        Column(modifier = Modifier.padding(16.dp)) {
            Text(title, style = CrateType.SectionTitle)
            Text(subtitle, fontSize = 12.sp, color = CrateColors.TextSecondary)
            Spacer(Modifier.height(14.dp))
            if (slices.isEmpty()) {
                Text("Scan local folders to visualize genre distribution.", fontSize = 12.sp, color = CrateColors.TextMuted)
            } else {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(16.dp),
                ) {
                    Canvas(modifier = Modifier.size(132.dp)) {
                        var startAngle = -90f
                        val stroke = Stroke(width = 24f)
                        val pad = 16f
                        val arcSize = Size(size.width - pad * 2, size.height - pad * 2)
                        slices.forEachIndexed { idx, slice ->
                            val sweep = (slice.share * 360f).coerceAtLeast(2f)
                            drawArc(
                                color = CrateColors.ChartPalette[idx % CrateColors.ChartPalette.size],
                                startAngle = startAngle,
                                sweepAngle = sweep - 1.5f,
                                useCenter = false,
                                topLeft = Offset(pad, pad),
                                size = arcSize,
                                style = stroke,
                            )
                            startAngle += sweep
                        }
                    }
                    Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        slices.take(6).forEachIndexed { idx, slice ->
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    Box(
                                        modifier = Modifier
                                            .size(8.dp)
                                            .clip(CircleShape)
                                            .background(CrateColors.ChartPalette[idx % CrateColors.ChartPalette.size])
                                    )
                                    Spacer(Modifier.width(8.dp))
                                    Text(slice.genre, fontSize = 12.sp, color = CrateColors.TextPrimary)
                                }
                                Text("${slice.count} · ${(slice.share * 100).toInt()}%", style = CrateType.TabularMono)
                            }
                        }
                    }
                }
            }
        }
    }
}

/**
 * 3. Daily Listening Trend Area/Line Chart (14-day rolling telemetry).
 */
@Composable
fun DailyListeningChartCard(
    points: List<DailyListeningPoint>,
    modifier: Modifier = Modifier,
) {
    StudioPanel(modifier = modifier.padding(2.dp)) {
        Column(modifier = Modifier.padding(16.dp)) {
            Text("Daily Listening", style = CrateType.SectionTitle)
            Text("Completed & active listening minutes across the last ${points.size} days", fontSize = 12.sp, color = CrateColors.TextSecondary)
            Spacer(Modifier.height(14.dp))
            val maxVal = points.maxOfOrNull { it.plays }?.coerceAtLeast(1) ?: 1
            Canvas(modifier = Modifier.fillMaxWidth().height(130.dp)) {
                if (points.size < 2) return@Canvas
                val stepX = size.width / (points.size - 1)
                val linePath = Path()
                points.forEachIndexed { i, pt ->
                    val x = i * stepX
                    val y = size.height - (pt.plays.toFloat() / maxVal) * (size.height - 16f) - 8f
                    if (i == 0) linePath.moveTo(x, y) else linePath.lineTo(x, y)
                    drawCircle(CrateColors.Accent, radius = 4f, center = Offset(x, y))
                }
                drawPath(linePath, color = CrateColors.Accent, style = Stroke(width = 3f))
            }
            Spacer(Modifier.height(6.dp))
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Text(points.firstOrNull()?.label.orEmpty(), style = CrateType.TabularMono)
                Text("${points.sumOf { it.plays }} plays · ${points.sumOf { it.minutes }} min", style = CrateType.TabularMono)
                Text(points.lastOrNull()?.label.orEmpty(), style = CrateType.TabularMono)
            }
        }
    }
}

/**
 * 4. Weekly Listening Habits Bar Chart (Mon–Sun cadence).
 */
@Composable
fun WeeklyHabitsChartCard(
    points: List<WeeklyHabitPoint>,
    modifier: Modifier = Modifier,
) {
    StudioPanel(modifier = modifier.padding(2.dp)) {
        Column(modifier = Modifier.padding(16.dp)) {
            Text("Weekly Listening Habits", style = CrateType.SectionTitle)
            Text("Plays grouped by day of week", fontSize = 12.sp, color = CrateColors.TextSecondary)
            Spacer(Modifier.height(14.dp))
            val maxVal = points.maxOfOrNull { it.plays }?.coerceAtLeast(1) ?: 1
            Canvas(modifier = Modifier.fillMaxWidth().height(120.dp)) {
                val barW = (size.width / points.size.coerceAtLeast(1)) * 0.56f
                val gap = size.width / points.size.coerceAtLeast(1)
                points.forEachIndexed { idx, pt ->
                    val h = (pt.plays.toFloat() / maxVal) * (size.height - 12f)
                    drawRoundRect(
                        color = if (pt.plays > 0) CrateColors.Emerald else CrateColors.SurfaceElevated,
                        topLeft = Offset(idx * gap + (gap - barW) / 2f, size.height - h.coerceAtLeast(6f)),
                        size = Size(barW, h.coerceAtLeast(6f)),
                        cornerRadius = CornerRadius(4f, 4f),
                    )
                }
            }
            Spacer(Modifier.height(6.dp))
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceAround) {
                points.forEach { Text(it.dayLabel, style = CrateType.TabularMono) }
            }
        }
    }
}

/**
 * 5. Weekly Tracks Added Ingestion Velocity Bar Chart.
 */
@Composable
fun WeeklyTracksAddedChartCard(
    points: List<WeeklyAddedPoint>,
    modifier: Modifier = Modifier,
) {
    StudioPanel(modifier = modifier.padding(2.dp)) {
        Column(modifier = Modifier.padding(16.dp)) {
            Text("Weekly Tracks Added", style = CrateType.SectionTitle)
            Text("Catalog ingestion velocity over the last ${points.size} weeks", fontSize = 12.sp, color = CrateColors.TextSecondary)
            Spacer(Modifier.height(14.dp))
            val maxVal = points.maxOfOrNull { it.count }?.coerceAtLeast(1) ?: 1
            Canvas(modifier = Modifier.fillMaxWidth().height(120.dp)) {
                val gap = size.width / points.size.coerceAtLeast(1)
                val barW = gap * 0.55f
                points.forEachIndexed { idx, pt ->
                    val h = (pt.count.toFloat() / maxVal) * (size.height - 12f)
                    drawRoundRect(
                        color = if (pt.count > 0) CrateColors.Accent else CrateColors.SurfaceElevated,
                        topLeft = Offset(idx * gap + (gap - barW) / 2f, size.height - h.coerceAtLeast(6f)),
                        size = Size(barW, h.coerceAtLeast(6f)),
                        cornerRadius = CornerRadius(4f, 4f),
                    )
                }
            }
            Spacer(Modifier.height(6.dp))
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceAround) {
                points.forEach { Text(it.weekLabel, style = CrateType.TabularMono) }
            }
        }
    }
}

/**
 * 6. Listening Activity Heatmap (12-week contribution matrix).
 */
@Composable
fun ListeningHeatmapCard(
    cells: List<HeatmapCell>,
    modifier: Modifier = Modifier,
) {
    StudioPanel(modifier = modifier.padding(2.dp)) {
        Column(modifier = Modifier.padding(16.dp)) {
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                Column {
                    Text("Listening Activity Heatmap", style = CrateType.SectionTitle)
                    Text("12-week daily session density", fontSize = 12.sp, color = CrateColors.TextSecondary)
                }
                Text("${cells.sumOf { it.plays }} sessions", style = CrateType.TabularMono, fontWeight = FontWeight.Medium)
            }
            Spacer(Modifier.height(12.dp))
            val intensityColors = listOf(
                Color(0xFF1A1D26),
                Color(0xFF4A1925),
                Color(0xFF8C1D30),
                Color(0xFFCC1F38),
                CrateColors.Accent,
            )
            Canvas(modifier = Modifier.fillMaxWidth().height(104.dp)) {
                val cols = (cells.size / 7).coerceAtLeast(1)
                val cellW = (size.width / cols) - 4f
                val cellH = (size.height / 7f) - 4f
                cells.forEachIndexed { idx, cell ->
                    val col = idx / 7
                    val row = idx % 7
                    drawRoundRect(
                        color = intensityColors[cell.intensity.coerceIn(0, 4)],
                        topLeft = Offset(col * (cellW + 4f), row * (cellH + 4f)),
                        size = Size(cellW.coerceAtLeast(6f), cellH.coerceAtLeast(6f)),
                        cornerRadius = CornerRadius(3f, 3f),
                    )
                }
            }
        }
    }
}
