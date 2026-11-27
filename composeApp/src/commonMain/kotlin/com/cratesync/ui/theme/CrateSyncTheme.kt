package com.cratesync.ui.theme

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * CrateSync Studio-Dark Design System.
 * 60% Obsidian Canvas (#0B0C0E), 30% Structural Surfaces (#111317 / #12141A / #161920),
 * 10% High-Intent Crimson Accent (#FF1F3D), Semantic states paired with icon + text.
 */
object CrateColors {
    val Canvas = Color(0xFF0B0C0E)
    val NavChrome = Color(0xFF111317)
    val Surface = Color(0xFF12141A)
    val SurfaceElevated = Color(0xFF161920)
    val BorderHairline = Color(0x14FFFFFF) // rgba(255,255,255,0.08)
    val BorderSubtle = Color(0x1FFFFFFF)

    val Accent = Color(0xFFFF1F3D)
    val AccentMuted = Color(0x26FF1F3D)

    val TextPrimary = Color(0xFFF4F6FA)
    val TextSecondary = Color(0xFFA0A8B8)
    val TextMuted = Color(0xFF6B7280)

    val Emerald = Color(0xFF22C55E)
    val Amber = Color(0xFFF59E0B)
    val CrimsonError = Color(0xFFEF4444)

    val ChartPalette = listOf(
        Color(0xFFFF1F3D),
        Color(0xFF22C55E),
        Color(0xFF38BDF8),
        Color(0xFFF59E0B),
        Color(0xFFA78BFA),
        Color(0xFFFB7185),
        Color(0xFF2DD4BF),
        Color(0xFFF97316),
    )
}

object CrateType {
    val TabularMono = TextStyle(
        fontFamily = FontFamily.Monospace,
        fontFeatureSettings = "tnum",
        fontSize = 12.sp,
        lineHeight = 16.sp,
        color = CrateColors.TextSecondary,
    )

    val TabularMetric = TextStyle(
        fontFamily = FontFamily.Monospace,
        fontFeatureSettings = "tnum",
        fontSize = 22.sp,
        fontWeight = FontWeight.SemiBold,
        lineHeight = 28.sp,
        color = CrateColors.TextPrimary,
    )

    val SectionTitle = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontSize = 16.sp,
        fontWeight = FontWeight.SemiBold,
        letterSpacing = (-0.2).sp,
        color = CrateColors.TextPrimary,
    )
}

private val CrateDarkScheme = darkColorScheme(
    primary = CrateColors.Accent,
    onPrimary = Color.White,
    background = CrateColors.Canvas,
    onBackground = CrateColors.TextPrimary,
    surface = CrateColors.Surface,
    onSurface = CrateColors.TextPrimary,
    surfaceVariant = CrateColors.SurfaceElevated,
    onSurfaceVariant = CrateColors.TextSecondary,
    outline = CrateColors.BorderHairline,
    error = CrateColors.CrimsonError,
)

private val CrateTypography = Typography(
    headlineMedium = TextStyle(
        fontWeight = FontWeight.Bold,
        fontSize = 24.sp,
        lineHeight = 30.sp,
        letterSpacing = (-0.5).sp,
        color = CrateColors.TextPrimary,
    ),
    titleMedium = TextStyle(
        fontWeight = FontWeight.SemiBold,
        fontSize = 15.sp,
        lineHeight = 20.sp,
        color = CrateColors.TextPrimary,
    ),
    bodyMedium = TextStyle(
        fontWeight = FontWeight.Normal,
        fontSize = 13.sp,
        lineHeight = 18.sp,
        color = CrateColors.TextPrimary,
    ),
    bodySmall = TextStyle(
        fontWeight = FontWeight.Normal,
        fontSize = 12.sp,
        lineHeight = 16.sp,
        color = CrateColors.TextSecondary,
    ),
    labelMedium = TextStyle(
        fontWeight = FontWeight.Medium,
        fontSize = 12.sp,
        lineHeight = 16.sp,
        color = CrateColors.TextSecondary,
    ),
)

@Composable
fun CrateSyncTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = CrateDarkScheme,
        typography = CrateTypography,
        content = content,
    )
}

/**
 * Single-elevation flat studio container bounded by a subtle 1dp hairline border.
 */
@Composable
fun StudioPanel(
    modifier: Modifier = Modifier,
    elevated: Boolean = false,
    content: @Composable () -> Unit,
) {
    Surface(
        modifier = modifier,
        color = if (elevated) CrateColors.SurfaceElevated else CrateColors.Surface,
        shape = RoundedCornerShape(10.dp),
        border = BorderStroke(1.dp, CrateColors.BorderHairline),
        content = content,
    )
}
